/// Keep the largest UTF-8 suffix that fits the byte budget.
pub fn retain_tail(text: &mut String, max_bytes: usize) {
    let mut start = text.len().saturating_sub(max_bytes);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text.drain(..start);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_limit_does_not_cut_a_multibyte_character() {
        let mut text = format!("{}x", "💡".repeat(2000));
        retain_tail(&mut text, 8000);
        assert_eq!(text, format!("{}x", "💡".repeat(1999)));
        assert!(text.len() <= 8000);
    }

    #[test]
    fn empty_zero_exact_and_sub_character_budgets() {
        for (input, limit, expected) in [
            ("", 0, ""),
            ("hello", 0, ""),
            ("hello", 5, "hello"),
            ("hello", 3, "llo"),
            ("é", 1, ""),
            ("é", 2, "é"),
        ] {
            let mut text = input.to_string();
            retain_tail(&mut text, limit);
            assert_eq!(text, expected);
        }
    }
}
