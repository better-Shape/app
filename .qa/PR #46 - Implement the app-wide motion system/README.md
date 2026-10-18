# UI capture for PR #46

This capture shows the Motion setting changing from Follow system to Reduce motion.

- `motion-preference.gif` is 8.71 seconds, 1100×688, and 251 KB. Moving frames run at 33.3 fps.
- `motion-preference.mp4` is the 30 fps alternative.
- `contact-sheet.png`, `review/`, and `screenshots/` contain visual QA evidence.
- `storyboard.json`, `timeline.json`, and `encode-report.json` record capture metadata.

The validator passed motion, smoothness, length, and caption coverage. Tesseract is not installed, so automated caption OCR was skipped. I reviewed the inspection sheet and subtitle strip. The selected value changes to Reduce motion, the cursor reaches both controls, and the captions match the screens.

The archive is committed with PR #46. Raw frames stay in the ignored `.qa-artifacts/motion-preference/frames/` directory.

PR: https://github.com/better-Shape/app/pull/46
