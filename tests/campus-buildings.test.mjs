import test from "node:test";
import assert from "node:assert/strict";

const b = await import("../src/map/campus-buildings.ts");

test("resolveRoomToBuilding maps common schedule room formats", () => {
  const cases = [
    ["一教A-301", "firstA"],
    ["一教A阶-102", "firstA"],
    ["一教A座 102", "firstA"],
    ["一教B-102", "firstB"],
    ["一教B阶-303", "firstB"],
    ["二教C-501", "secondC"],
    ["二教D-302", "secondD"],
    ["二教D-110", "secondD"],
    ["实验楼F-308", "labF"],
    ["实验楼A315", "labA"],
    ["实验楼B-308", "labB"],
    ["第十一微机室-实验楼A315", "labA"],
    ["第九微机室-实验楼A309", "labA"],
    ["体育馆东大门前广场1", "gym"],
    ["图书馆三层", "library"],
  ];
  for (const [room, expected] of cases) {
    assert.equal(b.resolveRoomToBuilding(room), expected, `room "${room}"`);
  }
});

test("resolveRoomToBuilding returns null for non-physical locations", () => {
  for (const room of ["未排地点", "网络课程", "无", "", null, undefined]) {
    assert.equal(b.resolveRoomToBuilding(room), null, `room "${room}"`);
  }
});

test("resolveRoomToBuilding handles whitespace around room names", () => {
  assert.equal(b.resolveRoomToBuilding(" 一教A-301 "), "firstA");
  assert.equal(b.resolveRoomToBuilding("二教D-302"), "secondD");
});

test("buildingDefByKey returns the matching definition", () => {
  const def = b.buildingDefByKey("firstA");
  assert.ok(def);
  assert.equal(def?.label, "一教A");
  assert.equal(def?.buildingId, "first");
  assert.equal(b.buildingDefByKey("nonexistent"), undefined);
});
