use crate::core::error::AppError;
use crate::mcp::{McpServerConfig, McpState, McpStatusEntry};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn mcp_config_path() -> Result<PathBuf, AppError> {
    let base = dirs::data_dir()
        .ok_or_else(|| AppError::Message("Could not resolve data directory".to_string()))?;
    Ok(base.join("shape").join("mcp.json"))
}

#[tauri::command]
pub fn get_mcp_config_path() -> Result<String, AppError> {
    Ok(mcp_config_path()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn ensure_mcp_config() -> Result<String, AppError> {
    let path = mcp_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Message(e.to_string()))?;
    }
    if !path.exists() {
        let default = "{\n  \"mcpServers\": {}\n}\n";
        fs::write(&path, default).map_err(|e| AppError::Message(e.to_string()))?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_mcp_config() -> Result<String, AppError> {
    let path = ensure_mcp_config()?;
    fs::read_to_string(&path).map_err(|e| AppError::Message(e.to_string()))
}

#[tauri::command]
pub fn write_mcp_config(content: String) -> Result<(), AppError> {
    // Same lock and same temp-file dance as the agent tool, so a save from
    // Settings cannot race one.
    crate::mcp::admin::write_raw(&content).map_err(AppError::Message)
}

#[tauri::command]
pub fn sync_mcp_servers(
    servers: Vec<McpServerConfig>,
    mcp_state: tauri::State<'_, McpState>,
) -> Result<Vec<McpStatusEntry>, AppError> {
    mcp_state
        .sync_servers(servers)
        .map_err(|e| AppError::Message(e))
}

#[tauri::command]
pub fn get_mcp_status(mcp_state: tauri::State<'_, McpState>) -> Result<Vec<McpStatusEntry>, AppError> {
    mcp_state.get_status().map_err(|e| AppError::Message(e))
}

#[tauri::command]
pub fn get_mcp_tools(mcp_state: tauri::State<'_, McpState>) -> Result<Vec<crate::mcp::McpToolInfo>, AppError> {
    mcp_state.all_tools().map_err(|e| AppError::Message(e))
}

#[tauri::command]
pub fn restart_mcp_server(
    id: String,
    mcp_state: tauri::State<'_, McpState>,
) -> Result<McpStatusEntry, AppError> {
    mcp_state.restart_server(&id).map_err(|e| AppError::Message(e))
}

#[tauri::command]
pub async fn mcp_start_oauth(
    id: String,
    mcp_state: tauri::State<'_, McpState>,
) -> Result<String, AppError> {
    // Blocks until the browser redirects to the loopback callback (or times out).
    let server_id = mcp_state
        .start_server_oauth(&id)
        .await
        .map_err(|e| AppError::Message(e))?;
    mcp_state
        .restart_server(&server_id)
        .map_err(|e| AppError::Message(e))?;
    Ok(server_id)
}

#[tauri::command]
pub async fn mcp_complete_oauth(
    callback_url: String,
    mcp_state: tauri::State<'_, McpState>,
) -> Result<String, AppError> {
    let server_id = crate::mcp::handle_oauth_callback(&callback_url)
        .await
        .map_err(|e| AppError::Message(e))?;
    mcp_state
        .restart_server(&server_id)
        .map_err(|e| AppError::Message(e))?;
    Ok(server_id)
}

#[tauri::command]
pub fn mcp_clear_oauth(id: String) -> Result<(), AppError> {
    crate::mcp::credentials::delete_token(&id).map_err(AppError::Message)?;
    Ok(())
}

/// What the agent's `mcp_manage` tool can do, exposed to the UI as well, so a
/// user action and an agent action share one implementation.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpManageRequest {
    pub action: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub server: Option<McpServerConfig>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[tauri::command]
pub async fn mcp_manage_servers(
    request: McpManageRequest,
    mcp_state: tauri::State<'_, McpState>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, AppError> {
    use crate::mcp::admin;
    use tauri::Emitter;

    let announce = |action: &str, id: Option<&str>| {
        let _ = app_handle.emit("mcp-servers-changed", serde_json::json!({ "action": action, "id": id }));
    };

    let action = request.action.trim().to_ascii_lowercase();
    let result = match action.as_str() {
        "list" => serde_json::json!({
            "servers": admin::load_servers().map_err(AppError::Message)?,
            "statuses": mcp_state.get_status().map_err(AppError::Message)?,
        }),
        "add" | "update" => {
            let cfg = request
                .server
                .ok_or_else(|| AppError::Message("`server` is required.".into()))?;
            let previous = admin::upsert(&cfg).map_err(AppError::Message)?;
            let status = mcp_state
                .upsert_server(cfg.clone())
                .map_err(AppError::Message)?;
            announce(&action, Some(&cfg.id));
            serde_json::json!({ "server": cfg, "status": status, "replaced": previous.is_some() })
        }
        "remove" => {
            let id = request
                .id
                .ok_or_else(|| AppError::Message("`id` is required.".into()))?;
            let removed = admin::remove(&id).map_err(AppError::Message)?;
            let _ = mcp_state.remove_server(&id);
            let _ = crate::mcp::credentials::delete_token(&id);
            announce("remove", Some(&id));
            serde_json::json!({ "removed": removed })
        }
        "enable" | "disable" => {
            let id = request
                .id
                .ok_or_else(|| AppError::Message("`id` is required.".into()))?;
            let enabled = request.enabled.unwrap_or(action == "enable");
            // Change nothing until the file confirms the server is there.
            let changed = admin::set_enabled(&id, enabled).map_err(AppError::Message)?;
            if !changed {
                return Err(AppError::Message(format!("'{id}' is not in mcp.json.")));
            }
            let Some(mut cfg) = admin::load_server(&id).map_err(AppError::Message)? else {
                return Err(AppError::Message(format!("'{id}' is not in mcp.json.")));
            };
            cfg.enabled = enabled;
            let status = mcp_state
                .upsert_server(cfg.clone())
                .map_err(AppError::Message)?;
            announce(&action, Some(&id));
            serde_json::json!({ "server": cfg, "status": status })
        }
        "restart" => {
            let id = request
                .id
                .ok_or_else(|| AppError::Message("`id` is required.".into()))?;
            let status = mcp_state.restart_server(&id).map_err(AppError::Message)?;
            announce("restart", Some(&id));
            serde_json::json!({ "status": status })
        }
        "test" => {
            let cfg = request
                .server
                .ok_or_else(|| AppError::Message("`server` is required.".into()))?;
            serde_json::to_value(admin::test_config(&cfg)).map_err(|e| AppError::Message(e.to_string()))?
        }
        other => {
            return Err(AppError::Message(format!(
                "Unknown action '{other}'. Use: list, add, update, remove, enable, disable, restart, test."
            )))
        }
    };
    Ok(result)
}

/// Re-read `mcp.json` and connect exactly what it lists. Servers added by the
/// agent (or hand-edited into the file) show up without restarting the app.
#[tauri::command]
pub fn mcp_reload_from_file(
    mcp_state: tauri::State<'_, McpState>,
) -> Result<Vec<McpStatusEntry>, AppError> {
    let file_servers = crate::mcp::admin::load_servers().map_err(AppError::Message)?;
    // Merge rather than replace: Settings-sourced servers never live in mcp.json,
    // and dropping them here would silently disconnect whatever the UI pushed.
    let file_ids: std::collections::HashSet<String> =
        file_servers.iter().map(|s| s.id.clone()).collect();
    let mut servers: Vec<McpServerConfig> = file_servers;
    servers.extend(
        mcp_state
            .configs_snapshot()
            .into_iter()
            .filter(|s| !file_ids.contains(&s.id)),
    );
    mcp_state.sync_servers(servers).map_err(AppError::Message)
}

#[tauri::command]
pub fn call_mcp_tool(
    qualified_name: String,
    arguments: Value,
    mcp_state: tauri::State<'_, McpState>,
) -> Result<String, AppError> {
    let args_json = serde_json::to_string(&arguments).unwrap_or_else(|_| "{}".to_string());
    mcp_state
        .call_tool(&qualified_name, &args_json)
        .map_err(|e| AppError::Message(e))
}
