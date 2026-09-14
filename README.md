# AUSTSec 官网

安徽理工大学网络安全协会官方站点。**纯静态、零依赖、零构建** —— 直接把仓库根目录发布到 GitHub Pages 即可。

**线上地址：<https://austsec.github.io/>**

仓库：<https://github.com/AustSec/AustSec.github.io>

```
.
├── index.html              # 单页叙事站点（序幕 / 协会 / 方向 / 加入）
├── .nojekyll               # 关键：告诉 GitHub Pages 不要跑 Jekyll 处理
├── deploy.ps1              # 一键部署脚本（init / commit / push）
├── assets/
│   ├── css/style.css       # 全部样式，含设计变量与响应式
│   └── js/main.js          # 粒子网络 + 逐字动效 + 分屏叙事 + 自绘光标
└── README.md
```

`_analysis/` 是构建期的分析脚本与预览截图，**不是站点的一部分**，删掉不影响运行。
其中 `preview/` 有几张效果截图可供参考。

---

## 一、这个站是怎么动的

访问路径是**分屏叙事**：滚轮 / 触摸滑动 / 方向键 / 点击右侧刻度，四者都能翻页，
一共 4 屏（序幕 → 协会 → 方向 → 加入）。左下的 `01 / 04` 是当前序号。

**背景的球状网络是程序生成的，不是图片也不是视频。** 用 Fibonacci 球面均匀撒 420 个点，
透视投影到 2D 后按空间距离连线；每帧**不清屏**，只盖一层 20% 透明度的黑——
于是旧帧不断衰减、留下磷光拖尾，这是画面质感的关键。鼠标移动会改变旋转角度。

**文字动效**：每个字被包进 `overflow:hidden` 的遮罩，从下方升起的同时由模糊变清晰。
逐字间隔是**自适应**的——字数多时自动压缩间隔（总展开时长上限 550ms），
否则长段落会拖到 3 秒以上，读起来像卡住。

**全站只有一个 `@keyframes`**（序幕那个下滑的滚动提示光点），其余动画全部由 JS 逐帧驱动。

---

## 二、部署状态与日常更新

### 已经上线了

仓库 `AustSec/AustSec.github.io` 属于**用户/组织站点**（仓库名 = `<组织名>.github.io`），
GitHub 会**自动**把它发布在域名根路径：

> **<https://austsec.github.io/>**

不需要手动去 Settings → Pages 里开启，也不需要 `gh-pages` 分支。
推送 `main` 分支后 1～2 分钟自动更新。

### 以后改完怎么发布

**一键脚本**（推荐）：

```powershell
powershell -ExecutionPolicy Bypass -File deploy.ps1
powershell -ExecutionPolicy Bypass -File deploy.ps1 -Message "调整首页文案"
```

脚本会依次做：检查仓库 → 校验身份 → `git add -A` → `git commit` → `git push`，
并在最后打印线上地址。

> `deploy.ps1` 刻意写成**纯 ASCII**。Windows PowerShell 5.1 用系统 ANSI 代码页
> （中文系统是 GBK）读取 `.ps1`，如果脚本里有中文会被解码错乱、导致语法报错。
> 改这个脚本时请继续保持纯 ASCII。

**手动命令**：

```bash
git add -A
git commit -m "改了什么"
git push
```

### 本地实时预览

写代码时不要靠 push 来看效果——本地起个服务，改完刷新即可：

```bash
python -m http.server 8080
# 打开 http://127.0.0.1:8080
```

> **注意**：GitHub Pages 没有「实时预览」和「PR 预览」。
> 它只发布指定分支，每次改动都必须 `commit` + `push`，再等 1～2 分钟构建。
> 真正的实时预览只能靠本地服务器。

### 换绑自定义域名（可选）

在 `Settings → Pages → Custom domain` 填域名，仓库根目录加一个 `CNAME` 文件，
内容就一行域名：

```
austsec.example.edu.cn
```

再到域名服务商处把 CNAME 记录指向 `austsec.github.io`。

---

## 三、为什么路径不用改

站内所有资源都用了**相对路径**：

```html
<link rel="stylesheet" href="./assets/css/style.css" />
<script src="./assets/js/main.js"></script>
```

所以无论部署在域名根路径（当前情况）还是子目录，都能正常加载。

> 常见坑：写成 `/assets/css/style.css`（开头带斜杠）后，子目录部署会 404 ——
> 它会被解析成 `用户名.github.io/assets/...` 而不是 `用户名.github.io/仓库名/assets/...`。

`.nojekyll` 这个文件不要删：它阻止 GitHub Pages 用 Jekyll 处理静态文件。
文件名以点开头，`git add .` 一般会带上；若没带上用 `git add -f .nojekyll`。

---

## 四、要改的地方（交付后请替换）

| 位置 | 内容 | 说明 |
|---|---|---|
| `index.html` 加入区 | `data-todo="填写报名表"` 的按钮 | 把 `href="#"` 换成真实问卷链接 |
| 同上 | `data-todo="加入新生群"` 的按钮 | 换成群二维码页或 QQ 群链接 |
| 目录浮层底部 | `https://github.com/` | 换成协会的 GitHub 组织地址 |
| 数据 | `data-count="1200"` / `31` / `80` | 改数字即可，千分位自动处理 |
| 目录浮层底部 | 「仅用于教学与研究」声明 | 建议保留，避免被误解为提供攻击服务 |

---

## 五、换配色

所有颜色集中在 `assets/css/style.css` 顶部的 `:root`：

```css
--bg:     #000000;                    /* 底色 */
--fg:     #efefef;                    /* 前景文字 */
--accent: #00ffff;                    /* 强调色：进度线、序号、状态点 */
```

几个现成的搭配：

| 风格 | `--accent` |
|---|---|
| 青色（当前） | `#00ffff` |
| 终端绿 | `#4ade80` |
| 警示红 | `#ff3b3b` |
| 琥珀橙 | `#ff9500` |
| 电紫 | `#a78bfa` |

想整体提亮一档（不要纯黑），把 `--bg` 改成 `#0a0a0a` 或 `#111`，同时把
`main.js` 里 `ctx.fillStyle = '#000'` 和 `'rgba(0,0,0,0.20)'` 同步改掉，
否则拖尾会把底色刷回纯黑。

---

## 六、设计说明

视觉系统照 [exp-ion.lusion.co](https://exp-ion.lusion.co/) **实测还原**（通过 CDP 抓取计算样式，非目测）：

- **配色**：底 `#000` / 前景 `#efefef`。全套只有这一组灰阶 + 一点青色点缀。
- **字体**：原站用 PP Neue Montreal（商业字体）。这里用 Inter + 系统中文字体替代；
  买了授权就在 `style.css` 的 `--font-display` 第一位换成 `'PPNeueMontreal'`。
- **大标题**：`500` 字重、`line-height:95%`、`letter-spacing:-.02em`。
  **靠字号和间距撑气势，不是靠加粗**——这点和常见做法相反，是它显得高级的原因。
- **角标**：`11px / 600 / uppercase / letter-spacing:.12em`。
- **按钮**：`border-radius:50px` + `1px solid #efefef` + 透明底；悬停时
  `.btn-text` 整体上移 50%，露出第二行同样的文字，形成「翻字」效果。
- **右侧进度线**：`1px` 宽，轨道 `rgba(51,51,51,.5)`，进度条 `scaleY` 从顶部生长。
- **自绘光标**：`50px` 圆形，`rgba(239,239,239,.14)` 填充，阻尼跟随；悬停可交互元素时放大变色。
- **无障碍**：完整支持 `prefers-reduced-motion`（关掉全部动效、粒子图静态渲染一帧）；
  刻度与按钮都有 `aria-label`；装饰元素标记 `aria-hidden`。
- **性能**：粒子渲染节流到 34fps，页面隐藏时自动暂停；`devicePixelRatio` 上限 2；
  仅有的外部请求是 Google Fonts（可自行删除，见下）。

### 去掉外部字体请求

`index.html` 里删掉这三行即可完全离线：

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:..." rel="stylesheet" />
```

删掉后会退回系统字体（Windows 上是 Segoe UI，中文是微软雅黑），效果依然可用。

---

## 七、本地预览

```bash
python -m http.server 8080
# 打开 http://localhost:8080
```

直接双击 `index.html` 也能看，但用本地服务器更接近 GitHub Pages 的真实环境。
