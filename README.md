# Persona Mobile

Persona Agent 的移动端客户端，连接你本地运行的 [Persona Agent Server](https://github.com/Code-MonkeyZhang/persona-agent)，在手机上与 AI Agent 对话。

基于 [SwiftChat](https://github.com/aws-samples/swift-chat) 二次开发。

## 功能

### 对话

- WebSocket 流式输出，实时接收 Agent 回复
- Markdown 渲染（代码高亮、表格、Mermaid 图表）
- 代码块一键复制
- 会话历史管理，侧边栏快速切换

### Agent

- 浏览所有 Agent，查看详情（模型配置、系统提示词、MCP 服务、Skills）
- 聊天界面顶部一键切换 Agent
- Agent 头像显示

### 伴侣模式

- 全屏展示角色立绘 + 背景图
- Agent 根据对话自动切换表情（pose）
- 支持语音合成朗读回复

### 设置

- 配置 Persona Agent Server 地址
- 触觉反馈开关
- TTS API Key 配置
- 暗色 / 亮色主题切换

## 支持平台

| 平台 | 方式 |
|------|------|
| Android | 下载 APK 安装 |
| iOS | Xcode 源码编译 |

## 开发

```bash
cd react-native
npm install

# 启动 Metro
npm start
```

### 构建 Android

```bash
npm run android
```

或手动构建 Release APK：

```bash
cd android && ./gradlew assembleRelease
```

APK 输出路径：`android/app/build/outputs/apk/release/Persona.apk`

### 构建 iOS

首次需要安装原生依赖：

```bash
cd ios && pod install && cd ..
npm run ios
```

## 项目结构

```
react-native/
├── src/
│   ├── api/                # Server API 客户端（HTTP + WebSocket）
│   ├── agent-detail/       # Agent 详情全屏页
│   ├── chat/               # 聊天页面及子组件
│   │   └── component/
│   │       ├── markdown/   # Markdown 渲染器（代码、Mermaid、数学公式）
│   │       ├── AgentSelector.tsx      # Agent 选择器
│   │       └── CustomMessageComponent.tsx  # 消息气泡
│   ├── companion/          # 伴侣模式全屏页
│   ├── history/            # 侧边栏 + 会话历史
│   ├── settings/           # 设置页面
│   ├── stores/             # Zustand 状态管理
│   ├── theme/              # 主题系统（亮色/暗色）
│   ├── storage/            # MMKV 本地存储
│   ├── types/              # TypeScript 类型
│   └── utils/              # 工具函数
├── android/                # Android 原生代码
├── ios/                    # iOS 原生代码（Persona.xcworkspace）
└── package.json
```

## 连接 Server

1. 确保电脑上运行着 [Persona Agent Server](https://github.com/Code-MonkeyZhang/persona-agent)（桌面端启动即可自动运行）
2. 在手机上打开 Persona → 设置 → 填入 Server 地址（如 `http://192.168.1.100:3847`）
3. 连接成功后即可开始对话

Server 开启 Cloudflare Tunnel 后也可通过公网地址连接。

## 技术栈

- **框架**: React Native 0.74 + TypeScript
- **状态管理**: Zustand
- **存储**: react-native-mmkv
- **导航**: React Navigation 7（Drawer + Native Stack）
- **图标**: Lucide React Native
- **聊天 UI**: react-native-gifted-chat（定制版）
- **音频**: react-native-track-player（TTS 播放）

## License

[MIT-0](LICENSE)
