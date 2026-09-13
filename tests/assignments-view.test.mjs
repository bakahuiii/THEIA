import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const view = await readFile(new URL("../src/views/AssignmentsView.tsx", import.meta.url), "utf8")
const styles = await readFile(new URL("../src/styles/visual-refinement-workspace.css", import.meta.url), "utf8")

test("assignments view separates task type tabs from status filters", () => {
  assert.match(view, /const \[kindFilter, setKindFilter\] = useState<"assignments" \| "tests">\("assignments"\)/u)
  assert.match(view, /const \[statusFilter, setStatusFilter\] = useState<"pending" \| "completed" \| "all">\("pending"\)/u)
  assert.match(view, /className="assignment-kind-tabs"/u)
  assert.match(view, /<span>作业<\/span>/u)
  assert.match(view, /<span>在线测试<\/span>/u)
  assert.match(view, /className="assignment-status-tabs"/u)
  assert.match(view, /已完成/u)
  assert.match(view, /if \(statusFilter === "completed"\) return item\.status === "submitted";/u)
  assert.match(view, /if \(statusFilter === "all"\) return !isExpiredAssignment\(item\);/u)
})

test("assignment filters have a distinct primary and secondary visual hierarchy", () => {
  assert.match(styles, /\.assignment-filters \{/u)
  assert.match(styles, /\.assignment-kind-tab\.active \{/u)
  assert.match(styles, /\.assignment-status-tab\.active \{/u)
  assert.match(styles, /@media \(max-width: 640px\)/u)
})
