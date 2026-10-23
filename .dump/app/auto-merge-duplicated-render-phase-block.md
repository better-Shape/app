# Auto-merge duplicated a render-phase capture block (2026-10-23)

While absorbing PR #3's fead3a96 via cherry-pick onto mega/absorb-all, the auto-merge left
features/git/ui/graph/graph-detail-panel.tsx (staged as 'M', not conflicted) containing TWO
copies of the filesInputs render-phase capture block (useState + conditional setFilesInputs
during render). tsc caught it: 4x TS2451 "Cannot redeclare block-scoped variable". I had
treated 'auto-merged, staged only' as done and only verified the 21 conflicted files. Lesson:
run the typecheck gate BEFORE cherry-pick --continue, not merely after the cluster; an
auto-merge result is also a candidate for hidden duplication. Corrected behaviour: resolve
Ã¢ conf licts, then typecheck+lint BEFORE continue; fix staging errors then; alert if the
sequencer reports conflicts fixed yet typecheck red.
