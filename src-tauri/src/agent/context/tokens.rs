//! One token estimator for every context budget in the app.
//!
//! `chars / 4` is the usual shortcut, but it is wrong in both directions:
//! dense code and JSON carry far more tokens per character (short identifiers,
//! punctuation, brackets) while CJK prose carries far more tokens per byte.
//! Compaction, the usage breakdown, and the repo map all compare against real
//! model windows, so they need an estimate that does not drift by 30%.
//!
//! Classification is deliberately cheap — one pass over the characters:
//!
//! * CJK / kana / hangul: about one token per character.
//! * ASCII words: one token per word, plus one per four extra characters
//!   (`tokens` ≈ 2, `configuration` ≈ 4) — matching BPE behaviour on prose.
//! * Everything else (punctuation, operators, emoji, Cyrillic): half a token,
//!   which lands close to how symbol-heavy text splits.
//!
//! The numbers are estimates, not tokenizer output. They are consistent with
//! each other, which is what budgets need.

/// Rough token count for `text`. Never returns 0 for non-empty input.
pub fn estimate_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    let mut tokens: f64 = 0.0;
    let mut word_chars: usize = 0;

    let flush_word = |word_chars: usize, tokens: &mut f64| {
        if word_chars > 0 {
            *tokens += word_tokens(word_chars);
        }
    };

    for ch in text.chars() {
        if is_wide_script(ch) {
            flush_word(word_chars, &mut tokens);
            word_chars = 0;
            tokens += 1.0;
        } else if ch.is_ascii_alphanumeric() || ch == '_' || ch == '\'' {
            word_chars += 1;
        } else if ch.is_whitespace() {
            flush_word(word_chars, &mut tokens);
            word_chars = 0;
            // Newlines and indentation survive tokenization far more cheaply
            // than source characters suggest.
            if ch == '\n' {
                tokens += 0.25;
            }
        } else {
            flush_word(word_chars, &mut tokens);
            word_chars = 0;
            tokens += 0.5;
        }
    }
    flush_word(word_chars, &mut tokens);
    (tokens.ceil() as usize).max(1)
}

fn word_tokens(chars: usize) -> f64 {
    if chars <= 3 {
        1.0
    } else {
        (chars as f64 / 4.0).ceil()
    }
}

fn is_wide_script(ch: char) -> bool {
    matches!(ch as u32,
        0x1100..=0x11FF   // hangul jamo
        | 0x2E80..=0x2FDF // radicals / kangxi
        | 0x3040..=0x30FF // hiragana + katakana
        | 0x3400..=0x4DBF // CJK extension A
        | 0x4E00..=0x9FFF // CJK unified
        | 0xAC00..=0xD7AF // hangul syllables
        | 0xF900..=0xFAFF // CJK compatibility ideographs
        | 0xFF00..=0xFF60 // fullwidth forms
        | 0x20000..=0x2FA1F // CJK extensions B–F
    )
}

/// Characters that fit in `tokens` of budget, for callers that trim by chars.
pub fn chars_for_tokens(tokens: usize) -> usize {
    tokens.saturating_mul(4)
}

/// Head + tail excerpt of `text` sized to `max_tokens`, with a marker in the
/// middle. Keeping both ends matters: files open with imports and close with the
/// code the model just wrote about.
pub fn truncate_to_tokens(text: &str, max_tokens: usize) -> String {
    if estimate_tokens(text) <= max_tokens {
        return text.to_string();
    }
    let total = text.chars().count();
    // Chars per token follows the script: CJK costs about one token per
    // character, ASCII prose about one per four. Measure this text so the
    // result honours `max_tokens` either way, with a little headroom for the
    // marker below.
    let per_token = (total as f64 / estimate_tokens(text).max(1) as f64).max(1.0);
    let char_budget = ((max_tokens as f64) * per_token * 0.9) as usize;
    let char_budget = char_budget.clamp(120, chars_for_tokens(max_tokens).max(120));
    if total <= char_budget {
        return text.to_string();
    }
    let head_len = char_budget * 2 / 3;
    let tail_len = char_budget.saturating_sub(head_len).max(60);
    let head: String = text.chars().take(head_len).collect();
    let tail: String = text.chars().skip(total.saturating_sub(tail_len)).collect();
    let omitted = total.saturating_sub(head_len + tail_len);
    format!("{head}\n\n… [{omitted} chars omitted to save context] …\n\n{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_is_zero() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn prose_is_about_a_token_per_word_plus_change() {
        let text = "The quick brown fox jumped over the lazy dog and kept going.";
        let tokens = estimate_tokens(text);
        let words = text.split_whitespace().count();
        assert!(tokens >= words, "tokens={tokens} words={words}");
        assert!(tokens <= words * 2, "tokens={tokens} words={words}");
    }

    #[test]
    fn code_prices_higher_than_chars_over_four() {
        let code = r#"fn main(){let x=foo(bar,baz.map(|v|v+1));}"#;
        assert!(estimate_tokens(code) > (code.chars().count() + 3) / 4);
    }

    #[test]
    fn cjk_prices_about_one_per_char() {
        let cjk = "这是一个测试句子，用来估计分词数量。";
        let n = cjk.chars().count();
        let tokens = estimate_tokens(cjk);
        assert!(tokens >= n, "tokens={tokens} chars={n}");
        assert!(tokens <= n * 2, "tokens={tokens} chars={n}");
    }

    #[test]
    fn truncate_holds_the_budget_for_dense_text() {
        let text: String = "文件内容很密集".repeat(4_000);
        let out = truncate_to_tokens(&text, 1_000);
        assert!(
            estimate_tokens(&out) <= 1_200,
            "truncated to {} tokens",
            estimate_tokens(&out)
        );
    }

    #[test]
    fn truncate_keeps_head_and_tail() {
        let text: String = (0..400).map(|i| format!("line {i}\n")).collect();
        let out = truncate_to_tokens(&text, 40);
        assert!(out.contains("line 0"));
        assert!(out.contains("line 399"));
        assert!(out.contains("omitted"));
        assert!(estimate_tokens(&out) < estimate_tokens(&text));
    }

    #[test]
    fn truncate_leaves_short_text_alone() {
        assert_eq!(truncate_to_tokens("hello world", 500), "hello world");
    }
}
