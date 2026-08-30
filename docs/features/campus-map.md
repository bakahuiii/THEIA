# 校园地图

## 页面目标

校园地图页提供北京化工大学昌平校区的本地图片地图和楼层图，方便用户粗略定位教学楼和教室。

## 主要内容

- 校园总图和卫星图切换。
- 第一教学楼和第二教学楼的楼层图切换。
- 缩放、拖动和惯性浏览。
- 地图状态会记住上次打开时的建筑、楼层、图层和缩放位置。

## 数据来源

- 昌平校区总图
- 昌平校区卫星图
- 第一教学楼各层平面图
- 第二教学楼各层平面图
- localStorage 里的地图视图状态

## 边界

- 这是导航辅助，不是实时定位设备。
- 地图状态只保存在本机，不同步到云端。
- 切换建筑或楼层时，视图会重置，避免残留偏移造成误读。

## 相关文件

- src/views/CampusMapView.tsx
- src/map/campus-buildings.ts
- src/map/campus-pathfinding.ts
- src/assets/theia-changping-campus-map.jpg
- src/assets/theia-changping-campus-satellite-mercator.webp

## 细节

### 图层和楼层

- 校园总图和卫星图只在昌平校区这个总层级上切换。
- 第一教学楼和第二教学楼各有自己的楼层图。
- 切换建筑或楼层时，视图会重置，避免上一张图的偏移残留到下一张图上。

### 缩放和拖动

- 地图支持缩放、拖动和惯性浏览。
- 缩放上限会根据当前画布大小自动计算，避免放大到空白。
- 拖动过程中的位置会被保存到本机状态里。

### 视图记忆

- 最后一次打开时的建筑、楼层、图层、缩放和位置都会写入 localStorage。
- 下次打开时会先恢复这组值，再按当前图源做必要校正。

### 使用边界

- 这是导航辅助，不是实时定位设备。
- 地图状态只保存在本机，不同步到云端。
- 这页适合找楼和找楼层，不适合做严格路径规划。

## 代码级细节

- CampusMapView 用 readSavedMapView 从 localStorage 里恢复 building、floor、layer、zoom 和 position。
- getMapSource 根据 building / floor / layer 选出当前图源；校园总图只有 campus 和 satellite 两种 layer，楼层图只看 building 和 floor。
- syncMaxZoom 会根据 stage 尺寸和 baseSource 尺寸重新计算可缩放上限，并把 zoom 限死在最大值以内。
- stopInertia、resetViewForSource 和 applyPosition 是控制拖动、复位和位置同步的关键函数。
- zoomByRef、inertiaFrameRef、dragRef 和 positionRef / zoomRef 用来把鼠标滚轮、惯性和状态更新串起来，避免拖动过程中抖动。
- 切换建筑或楼层时会先重置视图，再重新计算当前图片的适配尺寸。
