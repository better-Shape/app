//! Image-tag metadata shared by producers and attachment-name lookup.

/// Encode metadata without letting attribute delimiters become image payload.
pub(crate) fn escape_xml_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Keep the data URL immediately after the first closing angle bracket.
pub(crate) fn image_tag(name: &str, mime: &str, data_url: &str) -> String {
    let escaped_name = escape_xml_attr(name);
    let encoding = if escaped_name == name {
        ""
    } else {
        " name_encoding=\"xml\""
    };
    let mime = escape_xml_attr(mime);
    format!("<attached_image name=\"{escaped_name}\"{encoding} type=\"{mime}\">{data_url}</attached_image>")
}

/// Decode versioned names once, retaining legacy literal and partial-name lookup.
pub(crate) fn image_name_matches(attrs: &str, name_lc: &str) -> bool {
    if attrs.contains(" name_encoding=\"xml\"") {
        return decoded_name(attrs).is_some_and(|name| name.contains(name_lc));
    }
    let name_ok = attrs.contains(&format!("name=\"{name_lc}\""))
        || attrs.contains(&format!("name='{name_lc}'"))
        || (name_lc.is_empty() && attrs.contains("name="));
    name_ok || (!name_lc.is_empty() && attrs.contains(name_lc))
}

/// Match asset filenames or media IDs without broad substring matching.
pub(crate) fn asset_name_matches(attrs: &str, name_lc: &str) -> bool {
    if name_lc.is_empty() || attrs.contains(&format!("media_id=\"{name_lc}\"")) {
        return true;
    }
    if attrs.contains(" name_encoding=\"xml\"") {
        return decoded_name(attrs).is_some_and(|name| name == name_lc);
    }
    attrs.contains(&format!("name=\"{name_lc}\""))
}

/// Locate an inline asset payload without consuming its surrounding instructions.
pub(crate) fn asset_data_url(body: &str) -> Option<&str> {
    let body = body.trim();
    if body.starts_with("data:") {
        return Some(body);
    }
    let (_, tail) = body.rsplit_once('\n')?;
    let tail = tail.trim();
    tail.starts_with("data:").then_some(tail)
}

/// Extract only the producer's name attribute, not type or encoding metadata.
fn decoded_name(attrs: &str) -> Option<String> {
    attrs
        .split_once(" name=\"")
        .and_then(|(_, rest)| rest.split_once('"'))
        .map(|(name, _)| decode_xml_attr(name))
}

/// Decode the producer's four entities once, with ampersands last to avoid aliases.
fn decode_xml_attr(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_plain_image_tags() {
        assert_eq!(image_tag("a.png", "image/png", "data:image/png;base64,YQ=="),
            "<attached_image name=\"a.png\" type=\"image/png\">data:image/png;base64,YQ==</attached_image>");
    }

    #[test]
    fn frames_image_payload_after_escaped_metadata() {
        let tag = image_tag("a>\"<&.png", "image/png\">", "data:image/png;base64,YQ==");
        assert_eq!(tag, "<attached_image name=\"a&gt;&quot;&lt;&amp;.png\" name_encoding=\"xml\" type=\"image/png&quot;&gt;\">data:image/png;base64,YQ==</attached_image>");
        assert!(tag.split_once('>').unwrap().1.starts_with("data:"));
    }

    #[test]
    fn distinguishes_encoded_and_entity_looking_filenames() {
        let attrs = r#"<attached_image name="a&gt;b.png" name_encoding="xml""#;
        assert!(image_name_matches(attrs, "a>b.png"));
        assert!(!image_name_matches(attrs, "a&gt;b.png"));
        assert!(!image_name_matches(attrs, "gt;"));
        assert!(!image_name_matches(attrs, "xml"));
        let literal = r#"<attached_image name="a&amp;gt;b.png" name_encoding="xml""#;
        assert!(image_name_matches(literal, "a&gt;b.png"));
        assert!(!image_name_matches(literal, "a>b.png"));
    }

    #[test]
    fn looks_up_escaped_names_and_preserves_partial_names() {
        for name in [
            "a>b.png",
            "a\"b.png",
            "a<b.png",
            "a&b.png",
            "a&gt;b.png",
            "漢>字.png",
        ] {
            let tag = image_tag(name, "image/png", "data:image/png;base64,YQ==");
            let attrs = tag.split_once('>').unwrap().0.to_ascii_lowercase();
            assert!(image_name_matches(&attrs, name));
            assert_eq!(image_name_matches(&attrs, "b.png"), name.contains("b.png"));
        }
    }

    #[test]
    fn preserves_legacy_raw_and_partial_name_lookup() {
        for name in ["a&b.png", "a&gt;b.png", "o'brien.png"] {
            let attrs = format!("<attached_image name=\"{name}\"");
            assert!(image_name_matches(&attrs, name));
        }
        assert!(image_name_matches(
            "<attached_image name='folder/a.png'",
            "a.png"
        ));
        assert!(image_name_matches("<attached_image name=\"a.png\"", ""));
        assert!(!image_name_matches(
            "<attached_image type=\"image/png\"",
            ""
        ));
    }

    #[test]
    fn escapes_literal_entities_once() {
        assert_eq!(
            escape_xml_attr("a&gt;b&\"<.png"),
            "a&amp;gt;b&amp;&quot;&lt;.png"
        );
    }
    #[test]
    fn assets_distinguish_encoded_and_literal_entity_names() {
        let attrs = r#"<attached_asset name="a&gt;b.woff" name_encoding="xml" usable="true""#;
        assert!(asset_name_matches(attrs, "a>b.woff"));
        assert!(!asset_name_matches(attrs, "a&gt;b.woff"));
        assert!(!asset_name_matches(attrs, "b.woff"));
        assert!(!asset_name_matches(attrs, "xml"));
        let literal = r#"<attached_asset name="a&amp;gt;b.woff" name_encoding="xml""#;
        assert!(asset_name_matches(literal, "a&gt;b.woff"));
        assert!(!asset_name_matches(literal, "a>b.woff"));
    }

    #[test]
    fn assets_keep_legacy_name_and_media_id_matching() {
        let attrs = r#"<generated_image name="a&gt;b.png" media_id="image-1""#;
        assert!(asset_name_matches(attrs, "a&gt;b.png"));
        assert!(!asset_name_matches(attrs, "a>b.png"));
        assert!(asset_name_matches(attrs, "image-1"));
        assert!(asset_name_matches(attrs, ""));
        assert!(!asset_name_matches(attrs, "b.png"));
    }

    #[test]
    fn reads_legacy_asset_instructions_and_bare_payloads() {
        let data = "data:font/woff;base64,YQ==";
        assert_eq!(asset_data_url(data), Some(data));
        let legacy = format!("Use this asset in the project.\n{data}");
        assert_eq!(asset_data_url(&legacy), Some(data));
        assert_eq!(asset_data_url("Nothing inlined"), None);
        // Leave trailing junk for the actual base64 decoder to reject.
        assert_eq!(
            asset_data_url("data:font/woff;base64,YQ==\nNot a payload"),
            Some("data:font/woff;base64,YQ==\nNot a payload")
        );
        assert_eq!(asset_data_url("instructions\nnot-data"), None);
    }
}
