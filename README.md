# Minecraft 名牌工坊 · Minecraft Nameplate Studio

上传 **64×64 皮肤 PNG** + 填写 **玩家 ID** → 生成一张**横版矩形像素名牌**：
一侧是皮肤头像（three.js 渲染的 3D 方块头像，或 2D 正面像），另一侧是像素点阵 ID，
两块沿宽度方向按**黄金分割**切分。

纯前端，无后端：皮肤不上传，全部在浏览器本地完成。

---

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 构建 | Vite 8（rolldown） |
| 框架 | React 19 + TypeScript（strict） |
| 样式 | Tailwind CSS 4 + 一套手写像素控件（`src/index.css`） |
| 路由 | React Router 7（生成器 / 说明两个页面） |
| 3D | three.js（动态 import，单独分包，首屏不加载） |
| 测试 | Vitest（纯逻辑）+ Playwright（端到端视觉验证） |

## 快速开始

```bash
# 依赖（本机 node 为裸二进制时，见文末「安装说明」）
npm install

npm run dev            # 开发服务器 http://127.0.0.1:5273
npm run test           # 单元测试
npm run build          # 类型检查 + 生产构建到 dist/
npm run preview        # 预览 dist/
npm run verify:visual  # 端到端视觉验证（截图 + 导出 PNG 到 verification/）
```

## 目录结构

```
src/
├─ app/router.tsx                    路由表
├─ components/
│  ├─ layout/AppShell.tsx            顶栏 / 页脚 / 导航
│  └─ pixel/                         PixelButton / PixelChip / PixelToggle / PixelSlider / Panel
├─ hooks/
│  ├─ useSkinUpload.ts               File → RgbaImage → ParsedSkin
│  ├─ useNameplateRenderer.ts        防抖重绘 + 字体/three.js 就绪状态
│  ├─ useNameplateConfig.ts          配置状态
│  └─ useImagePaste.ts               Ctrl/⌘+V 粘贴皮肤
├─ features/nameplate/
│  ├─ config.ts                      配置模型、宽高比预设、默认值
│  ├─ theme.ts                       主题解析（内置 / 由贴图现场推导，带缓存）
│  ├─ layout.ts                      名牌几何（纯函数，可单测）
│  ├─ headGeometry.ts                3D 投影几何（纯数学，布局与渲染共用）
│  ├─ resolve.ts                     「自适应宽高比」等语义化设置解析
│  ├─ renderer.ts                    渲染主流程
│  ├─ draw/
│  │  ├─ panel.ts                    背景纹理 / 外框倒角 / 分割线 / 肖像位 / 文字压暗
│  │  ├─ head.ts                     2D 正面头像
│  │  ├─ head3d.ts                   three.js 立体头像
│  │  ├─ text.ts                     ID 文本
│  │  └─ guides.ts                   黄金分割辅助线
│  └─ components/                    上传 / ID / 版式 / 外观 / 导出 / 预览 六个界面模块
├─ lib/                              与 DOM 无关的纯逻辑
│  ├─ golden.ts                      黄金分割常量、切分、预设
│  ├─ skin.ts                        皮肤校验 + 六面抽取（2D 三面 / 3D 六面 + 帽子）
│  ├─ raster.ts                      RGBA 位图原语（裁切 / 合成 / 统计）
│  ├─ textures.ts                    程序化面板纹理（按面板尺寸生成，不平铺）
│  ├─ themes.ts                      底色主题数据表
│  ├─ palette.ts                     从方块贴图提取配色 + 推导整套主题
│  ├─ pixelFont.ts                   像素字体：原生点阵渲染 + 整数倍放大 + 适配倍率
│  ├─ imageIo.ts                     File / dataURL / canvas 互转、下载、剪贴板
│  └─ color.ts                       颜色工具
└─ pages/                            StudioPage / GuidePage / NotFoundPage
```

## 核心实现要点

**1. 黄金分割的两种落法**
`φ = (1+√5)/2`，长边 `1/φ = 0.6180339887`，短边 `1/φ² = 0.3819660113`。

- **纵向（默认）**：ID 字号取铭牌高度的 `1/φ²`。像素字体字形实际高度约为 em 的 75%，
  所以 em 取 0.5 时视觉字高 ≈ 38.2%。
- **横向（预设）**：严格按 38.2 : 61.8 切两块。⚠️ 这种切法下 ID 的可用宽度被锁死，
  字高最多只能到铭牌高度的 22%，会显得空旷——所以它不是默认值，而是一键可切的预设。

切分用 `floor` 保证两块之和恒等于内容区宽度，不会出现 1px 缝隙；滑杆在黄金取值
附近 `3e-4` 内自动吸附成精确值。

**2. 矩形铭牌 + 自适应宽高比 + 头像块收紧**
高度固定（256–1024），宽度默认由 `'auto'` 反推：

```
ID 目标字高 = 0.5 × 铭牌高度            （字形实际高度 ≈ 38%）
名字区宽度  = 文字原生宽度 × 目标字高 / 字体原生高
肖像块宽度  = 内容区高度                 （贴合头像，不浪费宽度）
总宽        = 肖像块 + 名字区 + 边距      → 宽高比
```

实测：10 字符 ID、高 512 → 2500×512（4.88:1），头像 397px（占高 78%），
ID 字形高 186px（占高 36%）、横向利用率 90%。
也可固定 4:1 / 3:1 / 2:1 / φ:1。

**3. 3D 头像（three.js）**
`BoxGeometry` 六个面各挂一张从皮肤裁出的 8×8 贴图，颜色按 Minecraft 原版逐面亮度
（顶 1.0 / 前后 0.8 / 左右 0.6 / 底 0.5）相乘；第二层（帽子）是 9/8 倍外壳，用 `alphaTest` 切硬边。
正交相机方向 `(0.62, 0.32, 1)`，轮廓宽高比 ≈ 1.038 —— 这个几何量与布局模块共用
（`headGeometry.ts`），保证头像框刚好贴合轮廓。渲染尺寸与头像框 1:1，直接 `drawImage` 贴到名牌上。
three.js 首次渲染前会异步加载，未就绪时自动回退 2D。

**4. 像素文字的硬边保证（不依赖任何字体文件）**
字形由 `scripts/build-bitmap-font.mjs` **烘成位图数据**（`src/lib/bitmapFontData.ts`，
三套字体 × 95 个 ASCII 字形），运行时按位自己合成点阵，再整数倍最近邻放大。两种来源：

| 字体 | 来源 | 说明 |
| --- | --- | --- |
| **Mojangles**（默认） | Minecraft 原版字模表 `ascii.png`（128×128，16×16 个 8×8 字格，`code = 索引`） | 原版就是**比例字体**：步进 = 墨迹宽 + 1，所以 `i` 只有 2px 宽 |
| Silkscreen / Press Start 2P | 无头 Chromium 逐字光栅化 | SIL OFL 1.1 |

为什么不用 `ctx.fillText`：webfont 一旦被 CSP / iframe / 隐私设置拦掉，canvas 会**静默回退**
到系统字体，名牌上的 ID 立刻变成模糊的抗锯齿文字，而且不报任何错（这就是"字体突然变糊"的根因）。
换成内置点阵后：
- 输出像素的 alpha 只可能是 0 / 255 —— **硬边是构造保证**，不是事后阈值化；
- 字号按"当前这段文字的真实墨迹上下界"计算（字母 5 行、带 `_` 多 1 行），
  所以"字高 = 铭牌高度 × 1/φ²"精确成立且不会裁掉下划线；
- 测量与合成全是纯函数，可在 Node 里直接断言。

重新烘焙：`npm run build:font`（需要本地 Chromium；原版字模表会缓存到 `.cache/`，不进仓库）。

> 授权说明：Mojangles 是 Mojang 的字体，这里按需求从官方资源烘焙成点阵使用；
> 项目自身附带的 Silkscreen / Press Start 2P 为 SIL OFL 1.1。

**5. 底色：内置主题 + 贴图驱动的自定义主题**

内置 6 个主题是数据表（程序化生成，无外部素材）。第 7 项「自定义纹理」面向 Mod：

- 拖入**任意方块贴图**（原版材质包或 Mod 的 `assets/.../textures/block/*.png`），一次可多张，点选切换；
- 程序用 `src/lib/palette.ts` **从贴图里提取配色**：
  - 4bit/通道量化统计主色 → `base`（占比最高）
  - 从有足够占比的主色簇里挑最亮/最暗 → `light` / `dark`
    （不用裸亮度分位：80% 是中间调时 85 分位仍然是中间调）
  - 按饱和度 × √占比挑 `accent`，另给 `average` 与平均亮度
  - 文字色按对比度自动选深/浅，描边色取反侧，外框与肖像位由主色推导明暗
- **贴图只当取色源，不平铺**：底纹是用提取出的 base/light/dark 现场生成的颗粒面
  （与内置主题同一套生成器）——平铺原图会让画面变成一块重复花布，也压不住文字；
- 提取结果会直接显示在界面上（配色条 + 每个色值），可随时切回内置主题；
- 因为底纹本来就是程序化生成的，SVG / 3D 导出天然一致，不需要 UV repeat 或
  `KHR_texture_transform`。

**6. 背景不平铺**
按面板的纹理像素尺寸（`铭牌高度 / 256` 为一格）整块生成，顶部草皮只有一条，
因此不会出现小方块平铺造成的横向条纹。

**7. 渲染路径可观测**
`canvas.dataset.renderMode` 会标记 `3d` / `2d` / `none`，e2e 与调试都据此断言，
确保实际跑的是 three.js 而不是回退分支。

**7. 分层导出：2D 矢量 SVG + 整块名牌的 3D 模型包**

两个导出走**同一份分层策略**与同一份文字排版（`textLayout.ts`），保证三处一致。

**「下载 3D 模型包」（ZIP）** —— 整块名牌的三维体，按分层拆成 35 个对象：

```
名牌   底板(有厚度) / 背景 / 外框倒角×4 / 分割线×2 / 肖像位(凹槽:底+四壁)
头像   基础层 6 面 + 帽子层 6 面（1.125 倍外壳）
ID文字  每个字符一个对象（点阵逐段挤出，带真实厚度）
```

世界坐标：X 向右、Y 向上、Z 朝向观察者，名牌高度 = 1 单位，**底板轴对齐躺在 z = 0 平面**；
2.5D 视角烘在头像立方体自身的旋转里——从 +Z 正交看过去与 2D 预览逐像素一致，
但在 Blender 里就是一个正常的"立体名牌"。包内提供三条路：

| 文件 | 给谁用 |
| --- | --- |
| `blender/build_nameplate_3d.py` | Blender：运行即生成原生集合/对象/材质/UV，贴图自动 pack，另存即为 .blend |
| `nameplate.glb` | **推荐**：glTF 二进制单文件，Blender / Spline 直接拖入（贴图在 BIN chunk 里） |
| `nameplate.gltf` | glTF 2.0（贴图走 data URI），Three.js / 其他工具 |
| `nameplate.obj` + `.mtl` + `textures/` | 通用交换格式 |

> **导入后看不到贴图？** 先确认 Blender 视口不是 **Solid** 模式——Solid 渲染永远不显示 image texture，
> 只显示材质基础色，所以一片灰是正常的；按 `Z` → Material Preview 即可。
> 用建场脚本时它会自动切到 Material Preview。想核实贴图有没有进文件：
> 点任一材质，Shading 面板里应有接好的 Image Texture 节点。
> 导出结果用 **Khronos 官方 glTF-Validator** 卡在 CI 里：`npm run validate:gltf`（0 error / 0 warning）。

> 不直接产出 `.blend`：它是 Blender 的内存转储二进制，结构随版本变化，程序生成无法保证被正确加载；
> 建场脚本生成的是完全原生的场景，等价且不会版本不兼容。

**分层 SVG 导出（Figma 可编辑）**
`src/features/nameplate/exportSvg.ts` 把同一个布局计划输出成 SVG，**每个构件一个命名图层**：

```
底板 / 背景纹理 / 外框倒角 / 分割线 / 头像肖像位 / 文字压暗 / 头像 / ID文字 / 黄金辅助线
  └ ID文字 → 每个字符一个 <g id="ID文字-01-N">，内部按颜色拆成矢量 <path>
```

实测 30 个图层。其中：
- ID 文字是**矢量路径**（不是贴图），拖进 Figma 可以逐字改色、缩放；
- 2.5D 模式下头像不再是"一张贴图"，而是**立方体几何**：基础层/帽子层 × 6 个面 = 12 个可单独选中的面图层，
  每个面是"仿射变换 + 蒙皮贴图"，几何与贴图都能改；
- 2D 头像按像素色块矢量化，3D 头像内嵌 PNG（WebGL 结果本质是栅格）；
- 背景纹理内嵌 PNG + `image-rendering="pixelated"`，纯色主题则是普通 `<rect>`；
- 文字压暗用 `<pattern>` 保持矢量。

## 测试与验证

```bash
npm run test            # 139 个单元测试
npm run check           # 一条命令：类型检查 + 单元测试 + 构建 + 端到端视觉验证
npm run validate:gltf   # 用 Khronos 官方校验器检查 3D 包里的 glTF / GLB
npm run verify:visual   # 只跑端到端视觉验证（会自动先构建）
```

单元测试覆盖：黄金分割常量与切分、皮肤校验与六面抽取、帽子图层合成、布局几何
（两种切分模式、两块填满、肖像位方正、头像框比例、像素对齐、极端尺寸）、
像素字体适配倍率、3D 投影几何、颜色与位图原语。

`verify:visual` 会启动 `vite preview`，用 Chromium 真实渲染，并**从画布像素里独立测量**：
画布尺寸与宽高比、贴合模式与黄金分割模式的交界线位置（与解析值误差 ≤ 2px）、
**ID 字高占铭牌高度的比例**、文字横向利用率、头像落点与高度占比、3D 路径标记、
头像轮廓宽高比、贴图是否被左右镜像（测试皮肤带左右标记）、2D 模式边缘是否存在半透明过渡、
**ID 区域内是否存在抗锯齿灰边**（用来抓"字体静默回退"这类回归）、
**上传方块贴图后底色确实换成该贴图**（采样画布像素与贴图主色比对）、
**SVG 的图层结构与回渲染一致性**（把导出的 SVG 重新渲染成图并留档对比）、
**3D 模型包**：解压校验文件清单、OBJ 对象/三角面数、glTF/GLB 结构与 buffer 长度、
**Khronos 官方 glTF-Validator 0 error / 0 warning**、`python3 -m py_compile` 对 Blender 脚本做真实语法检查，
以及**自带软件渲染器把导出的 OBJ 从场景相机渲染出来与 2D 画布比对**（头像归一化位置偏差 < 3%，实测 0.07%）。

> 这个软件渲染器（`scripts/render-3d-preview.mjs`）就是抓到"贴图 V 轴翻转导致头像上下颠倒"的工具：
> 不用开 Blender 就能看见 3D 包到底长什么样。
产物在 `verification/`（含 `nameplate.svg` 与 `nameplate-from-svg.png`）。

## 许可与声明

- 字体：Silkscreen、Press Start 2P，均为 **SIL OFL 1.1**，见 `public/fonts/OFL-*.txt`。
- 底色纹理与测试皮肤夹具均为程序化生成，不含任何第三方素材。
- Minecraft 是 Mojang Studios 的商标，本项目与 Mojang 无关，仅处理用户自行提供的皮肤文件。

## 安装说明（本机 node 为裸二进制时）

本机 `node` 只有可执行文件、没有 npm，可用官方 tarball 直接引导：

```bash
mkdir -p .tooling && cd .tooling
curl -sSL -o npm.tgz https://registry.npmjs.org/npm/-/npm-10.9.4.tgz && tar xzf npm.tgz
node package/bin/npm-cli.js install          # 或加 --prefix 指向项目
```
