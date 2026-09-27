import type { ReactNode } from 'react'
import { Panel } from '../components/pixel'
import { GOLDEN_MAJOR, GOLDEN_MINOR, PHI } from '../lib/golden'
import { PIXEL_FONTS } from '../lib/pixelFont'
import { THEMES } from '../lib/themes'
import { HEAD3D_PROJECTION } from '../features/nameplate/headGeometry'

function Line({ children }: { children: ReactNode }) {
  return <p className="font-sans text-sm leading-relaxed text-ink-200">{children}</p>
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="border border-black bg-ink-900 px-1.5 py-0.5 font-mono text-xs text-grass-400">
      {children}
    </code>
  )
}

export function GuidePage() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="支持哪些皮肤">
        <div className="space-y-3">
          <Line>只接受玩家本人的皮肤 PNG 本体，按 Minecraft 官方贴图布局解析：</Line>
          <ul className="space-y-2 font-sans text-sm text-ink-200">
            <li>
              · <Code>64×64</Code> 现代皮肤（默认）：基础头层与第二层（帽子 / 头发）都会被读取，
              3D 模式下第二层是略微放大的独立外壳。
            </li>
            <li>
              · <Code>64×32</Code> 旧版皮肤：兼容，但没有第二层贴图。
            </li>
          </ul>
          <Line>
            头部六面坐标：正脸 <Code>(8,8)</Code>、角色左脸 <Code>(16,8)</Code>、右脸 <Code>(0,8)</Code>、
            头顶 <Code>(8,0)</Code>、下巴 <Code>(16,0)</Code>、后脑 <Code>(24,8)</Code>；第二层整体右移 32 列。
          </Line>
          <Line>
            模型（经典 Steve / 纤细 Alex）通过右臂区域是否透明自动识别，仅用于信息展示，不影响头像。
          </Line>
        </div>
      </Panel>

      <Panel title="两块比例：黄金分割">
        <div className="space-y-3">
          <Line>铭牌是横版矩形，沿宽度方向切成两块（头像 / ID），比例取黄金分割：</Line>
          <pre className="overflow-x-auto border-4 border-black bg-ink-900 p-3 font-mono text-xs text-grass-400">
{`φ = (1 + √5) / 2 = ${PHI.toFixed(10)}
长边 = 1/φ   = ${GOLDEN_MAJOR.toFixed(6)}  (${(GOLDEN_MAJOR * 100).toFixed(3)}%)
短边 = 1/φ²  = ${GOLDEN_MINOR.toFixed(6)}  (${(GOLDEN_MINOR * 100).toFixed(3)}%)
头像 : ID = 短边 : 长边`}
          </pre>
          <Line>
            默认让 ID 占长边（61.803%）。滑杆拖到 0.618 / 0.382 附近会自动吸附成精确值，
            也可以一键换成头像占长边，或左右互换。
          </Line>
          <Line>
            注意：严格按 38.2 : 61.8 切两块时，ID 的可用宽度被锁死，字高最多只能到铭牌高度的 22%。
            所以默认采用「<b className="text-ink-100">贴合头像</b>」——头像块按头像实际大小收紧，
            把宽度让给 ID，字高能做到 38% 左右；想要严格黄金分割，一键切预设即可。
          </Line>
          <Line>
            铭牌本身还有一层“宽高比”选择：<b className="text-ink-100">自适应（默认）</b>
            会按 ID 长度反推宽度，让 ID 字高稳定在铭牌高度的 1/φ² ≈ 38%（黄金分割用在纵向）
            ——短 ID 不会空旷，长 ID 也不会把字挤小；也可以固定成 4:1 / 3:1 / 2:1 / φ:1。
          </Line>
        </div>
      </Panel>

      <Panel title="头像怎么渲染">
        <div className="space-y-3">
          <Line>
            <b className="text-ink-100">3D 立体</b> 用 three.js 在离屏 WebGL 画布上渲染一个真正的方块模型：
          </Line>
          <ul className="space-y-1 font-sans text-sm text-ink-200">
            <li>· 正交投影相机，方向 {`(${HEAD3D_PROJECTION.direction.x.toFixed(2)}, ${HEAD3D_PROJECTION.direction.y.toFixed(2)}, ${HEAD3D_PROJECTION.direction.z.toFixed(2)})`}，轮廓宽高比 {HEAD3D_PROJECTION.aspect.toFixed(3)}</li>
            <li>· 逐面光照复刻原版：顶面 1.0、前后 0.8、左右 0.6、底面 0.5</li>
            <li>· 第二层（帽子）作为 9/8 倍外壳，用 alphaTest 切成硬边，不会被深度排序撕裂</li>
            <li>· 贴图最近邻采样 + MSAA 轮廓，渲染尺寸与头像框 1:1，直接贴到名牌上</li>
            <li>· three.js 走动态 import，首屏不加载；还没就绪时自动先用 2D 头顶图</li>
          </ul>
          <Line>
            <b className="text-ink-100">2D 正面</b> 则是纯像素路线：头像按 8 皮肤像素的整数倍放大，
            最近邻采样，边缘零半透明。
          </Line>
        </div>
      </Panel>

      <Panel title="像素画质是怎么保证的">
        <div className="space-y-3">
          <Line>
            字形是<b className="text-ink-100">烘进代码里的点阵数据</b>：默认 <b className="text-ink-100">Mojangles</b>
            （Minecraft 原版 <Code>ascii.png</Code> 字模，比例字体），另可选 Silkscreen / Press Start 2P。
            运行时按位合成、整数倍最近邻放大——输出像素的 alpha 只可能是 0 或 255，
            <b className="text-ink-100">硬边是构造保证</b>。
          </Line>
          <Line>
            这样即使 webfont 被 CSP / 扩展 / iframe 拦掉（界面文字会退回系统字体），
            名牌上的 ID 依然是锐利的像素字，不会变成模糊的抗锯齿文字。
          </Line>
          <Line>
            所有装饰尺寸（外框、倒角、留白、棋盘格压暗）都是 <Code>铭牌高度 / 256</Code> 的整数倍，
            保证任何分辨率下都对齐像素网格。
          </Line>
          <Line>
            背景<b className="text-ink-100">不是</b>平铺小方块贴图，而是按面板实际尺寸生成的一整块纹理
            （一个纹理像素 = 1 个网格单位），顶部草皮只有一条，因此不会出现重复条纹。
          </Line>
        </div>
      </Panel>

      <Panel title="字体与底色">
        <div className="space-y-4">
          <div className="space-y-2">
            {PIXEL_FONTS.map((font) => (
              <div key={font.id} className="mc-panel-flat px-3 py-2">
                <p className="mc-label text-grass-400">{font.name}</p>
                <p className="font-sans text-xs text-ink-300">{font.description}</p>
              </div>
            ))}
            <p className="font-sans text-xs text-ink-300">
              两种字体均为 SIL OFL 1.1 开源许可，已随项目本地托管（<Code>public/fonts/</Code>），
              不依赖任何外部 CDN。
            </p>
          </div>
          <div className="space-y-2">
            <p className="mc-label">底色主题</p>
            <ul className="space-y-1 font-sans text-xs text-ink-300">
              {THEMES.map((theme) => (
                <li key={theme.id}>
                  · <span className="text-ink-100">{theme.name}</span> — {theme.description}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title="导出：SVG（2D）与 3D 模型包">
        <div className="space-y-3">
          <Line>
            <b className="text-ink-100">「下载 SVG」</b>导出分层矢量文件，每个构件都是独立图层
            （实测 30 个）：
          </Line>
          <pre className="overflow-x-auto border-4 border-black bg-ink-900 p-3 font-mono text-xs text-grass-400">
{`底板 / 背景纹理 / 外框倒角 / 分割线 / 肖像位 / 文字压暗
头像
  └ 2.5D 时是立方体几何：基础层·帽子层 × 6 个面
     每个面 = 仿射变换 + 蒙皮贴图（可单独选中/替换）
ID文字 → 每个字符一个矢量分组`}
          </pre>
          <Line>
            <b className="text-ink-100">「下载 3D 模型包」</b>把<b className="text-ink-100">整块名牌</b>
            做成真正的三维体，按同一套分层拆成 35 个对象（底板有厚度、肖像位是凹槽、
            文字逐段挤出），内含：
          </Line>
          <ul className="space-y-1 font-sans text-sm text-ink-200">
            <li>· <Code>blender/build_nameplate_3d.py</Code> —— Blender 里运行即生成原生场景与材质，贴图自动打包</li>
            <li>· <Code>nameplate.gltf</Code> —— Blender / Spline / Three.js 直接导入</li>
            <li>· <Code>nameplate.obj</Code> + <Code>.mtl</Code> + 13 张贴图 —— 通用交换格式</li>
          </ul>
          <Line>
            为什么没有 .blend：它是 Blender 的内存转储二进制，结构随版本变化，程序生成无法保证被正确加载；
            建场脚本生成的是完全原生的场景，运行后另存即为 .blend，效果等价且不会版本不兼容。
          </Line>
        </div>
      </Panel>

      <Panel title="导出与隐私">
        <div className="space-y-3">
          <ul className="space-y-1 font-sans text-sm text-ink-200">
            <li>· 高度 512 / 宽高比自适应：论坛签名、群名片最常用</li>
            <li>· 高度 1024 以上：印刷或需要再裁切时使用</li>
            <li>· “复制图片”会直接写进剪贴板，方便粘到聊天窗口</li>
          </ul>
          <Line>
            皮肤读取、头像裁剪、3D 渲染、PNG 编码全部在浏览器本地完成，没有后端接口，
            也没有任何上传行为。刷新页面即清空。
          </Line>
        </div>
      </Panel>
    </div>
  )
}
