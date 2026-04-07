# SwiftChat 项目完整分析

---

## 一、项目整体结构

这是 **SwiftChat** (v2.7.0) — 一个由 AWS Samples 开发的跨平台 AI 助手，基于 React Native 构建。

### 核心架构

| 部分           | 技术栈                                           | 说明                            |
| -------------- | ------------------------------------------------ | ------------------------------- |
| **移动端前端** | React Native 0.74 + TypeScript + Hermes          | Android/iOS/macOS 跨平台        |
| **后端服务**   | Python FastAPI + boto3                           | 部署到 AWS Lambda + API Gateway |
| **AI 模型**    | Amazon Bedrock (主) / Ollama / DeepSeek / OpenAI | 多模型提供商支持                |
| **状态管理**   | React Context + react-native-mmkv                | 高性能本地存储                  |
| **UI 组件**    | react-native-gifted-chat (定制版)                | 聊天界面框架                    |

---

## 二、代码了解路径（由浅入深）

### 第二阶段：应用入口与导航骨架

| 顺序 | 文件                                   | 说明                                           |
| ---- | -------------------------------------- | ---------------------------------------------- |
| 5    | `react-native/index.js`                | JS 入口，注册 App 组件                         |
| 6    | `react-native/src/App.tsx`             | **根组件** — 导航结构、主题 Provider、全局状态 |
| 7    | `react-native/src/types/RouteTypes.ts` | 所有路由/页面类型定义                          |
| 8    | `react-native/src/types/Chat.ts`       | 聊天核心数据类型                               |

### 第三阶段：核心数据层（状态管理 + 存储）

| 顺序 | 文件                                       | 说明                                            |
| ---- | ------------------------------------------ | ----------------------------------------------- |
| 9    | `react-native/src/history/AppProvider.tsx` | **全局状态** — Context Provider，管理会话列表等 |
| 10   | `react-native/src/storage/Constants.ts`    | 存储键名常量                                    |
| 11   | `react-native/src/storage/StorageUtils.ts` | **存储工具** — MMKV 的增删改查封装              |
| 12   | `react-native/src/theme/ThemeContext.tsx`  | 暗色/亮色主题切换                               |
| 13   | `react-native/src/theme/colors.ts`         | 主题色值定义                                    |

### 第四阶段：聊天核心页面

| 顺序 | 文件                                                          | 说明                          |
| ---- | ------------------------------------------------------------- | ----------------------------- |
| 14   | `react-native/src/chat/ChatScreen.tsx`                        | **聊天主页面** — 核心交互逻辑 |
| 15   | `react-native/src/chat/component/CustomMessageComponent.tsx`  | 消息渲染组件                  |
| 16   | `react-native/src/chat/component/CustomSendComponent.tsx`     | 发送按钮组件                  |
| 17   | `react-native/src/chat/component/EmptyChatComponent.tsx`      | 空聊天页引导                  |
| 18   | `react-native/src/chat/component/CustomChatFooter.tsx`        | 聊天底部功能区                |
| 19   | `react-native/src/chat/component/HeaderTitle.tsx`             | 聊天标题栏                    |
| 20   | `react-native/src/chat/component/ModelSelectionModal.tsx`     | 模型选择弹窗                  |
| 21   | `react-native/src/chat/component/WebSearchSelectionModal.tsx` | 搜索引擎选择                  |

### 第五阶段：API 层（与 AI 模型通信）

| 顺序 | 文件                                                    | 说明                                         |
| ---- | ------------------------------------------------------- | -------------------------------------------- |
| 22   | `react-native/src/api/bedrock-api.ts`                   | **Bedrock API** — 主要的后端通信（流式对话） |
| 23   | `react-native/src/api/bedrock-api-key.ts`               | Bedrock API Key 模式                         |
| 24   | `react-native/src/api/bedrock-api-key-image.ts`         | Bedrock 图片生成                             |
| 25   | `react-native/src/api/ollama-api.ts`                    | Ollama 本地模型 API                          |
| 26   | `react-native/src/api/open-api.ts`                      | OpenAI / DeepSeek API                        |
| 27   | `react-native/src/chat/util/BedrockMessageConvertor.ts` | 消息格式转换器                               |

### 第六阶段：Markdown 渲染子系统

| 顺序 | 文件                                                                  | 说明              |
| ---- | --------------------------------------------------------------------- | ----------------- |
| 28   | `react-native/src/chat/component/markdown/Markdown.tsx`               | Markdown 渲染入口 |
| 29   | `react-native/src/chat/component/markdown/CustomMarkdownRenderer.tsx` | 自定义渲染器      |
| 30   | `react-native/src/chat/component/markdown/Parser.tsx`                 | Markdown 解析器   |
| 31   | `react-native/src/chat/component/markdown/CustomTokenizer.ts`         | 自定义分词器      |
| 32   | `react-native/src/chat/component/markdown/ChunkedCodeView.tsx`        | 代码块渲染        |
| 33   | `react-native/src/chat/component/markdown/MermaidCodeRenderer.tsx`    | Mermaid 图表渲染  |
| 34   | `react-native/src/chat/component/markdown/HtmlCodeRenderer.tsx`       | HTML 预览渲染     |

### 第七阶段：功能模块

| 顺序 | 文件                                               | 说明                   |
| ---- | -------------------------------------------------- | ---------------------- |
| 35   | `react-native/src/settings/SettingsScreen.tsx`     | 设置页面               |
| 36   | `react-native/src/settings/TokenUsageScreen.tsx`   | Token 用量统计         |
| 37   | `react-native/src/prompt/PromptScreen.tsx`         | System Prompt 管理     |
| 38   | `react-native/src/image/ImageGalleryScreen.tsx`    | 图片画廊               |
| 39   | `react-native/src/app/CreateAppScreen.tsx`         | 即时 Web App 创建      |
| 40   | `react-native/src/app/AIWebView.tsx`               | WebView 桥接           |
| 41   | `react-native/src/history/CustomDrawerContent.tsx` | 侧边栏（历史记录列表） |
| 42   | `react-native/src/history/HistoryGroupUtil.ts`     | 历史分组工具           |

### 第八阶段：Web 搜索功能

| 顺序 | 文件                                                           | 说明                   |
| ---- | -------------------------------------------------------------- | ---------------------- |
| 43   | `react-native/src/websearch/services/WebSearchOrchestrator.ts` | 搜索协调器（核心调度） |
| 44   | `react-native/src/websearch/services/index.ts`                 | 搜索服务入口           |
| 45   | `react-native/src/websearch/services/IntentAnalysisService.ts` | 意图分析               |
| 46   | `react-native/src/websearch/providers/TavilyProvider.ts`       | Tavily 搜索提供商      |
| 47   | `react-native/src/websearch/providers/GoogleProvider.ts`       | Google 搜索提供商      |
| 48   | `react-native/src/websearch/types.ts`                          | 搜索类型定义           |

### 第九阶段：工具类与辅助

| 顺序 | 文件                                                | 说明                      |
| ---- | --------------------------------------------------- | ------------------------- |
| 49   | `react-native/src/utils/ModelUtils.ts`              | 模型工具（判断模型能力）  |
| 50   | `react-native/src/utils/ErrorUtils.ts`              | 错误处理                  |
| 51   | `react-native/src/chat/util/FileUtils.ts`           | 文件处理                  |
| 52   | `react-native/src/chat/util/DiffUtils.ts`           | Diff 算法（App 代码编辑） |
| 53   | `react-native/src/chat/service/VoiceChatService.ts` | 语音聊天服务              |

### 第十阶段：原生模块 & 后端服务

| 顺序 | 文件                                                       | 说明                                                |
| ---- | ---------------------------------------------------------- | --------------------------------------------------- |
| 54   | `react-native/ios/Services/NovaSonicService.swift`         | Amazon Nova Sonic 语音服务（iOS 原生）              |
| 55   | `react-native/ios/Services/AudioManager.swift`             | 音频管理器                                          |
| 56   | `react-native/ios/Services/ConversationManager.swift`      | 对话管理                                            |
| 57   | `react-native/ios/Modules/VoiceChat/VoiceChatModule.swift` | 语音聊天桥接模块                                    |
| 58   | `react-native/ios/Modules/FilePaste/FilePasteModule.m`     | 文件粘贴桥接模块                                    |
| 59   | `server/src/main.py`                                       | **后端入口** — FastAPI 路由（流式对话、图片生成等） |
| 60   | `server/src/image_nl_processor.py`                         | 图片自然语言处理                                    |

---



整个项目的核心脉络是：**App.tsx (导航) → ChatScreen.tsx (聊天页) → api/ (AI通信) → storage/ (持久化)**，抓住这条主线就能理解 80% 的代码。

---

## TODO List

- [ ] `react-native/index.js` — JS 入口，注册 App 组件
- [ ] `react-native/src/App.tsx` — 根组件：导航结构、主题 Provider、全局状态
- [ ] `react-native/src/types/RouteTypes.ts` — 所有路由/页面类型定义
- [ ] `react-native/src/types/Chat.ts` — 聊天核心数据类型
- [ ] `react-native/src/history/AppProvider.tsx` — 全局状态 Context Provider，管理会话列表等
- [ ] `react-native/src/storage/Constants.ts` — 存储键名常量
- [ ] `react-native/src/storage/StorageUtils.ts` — 存储工具，MMKV 的增删改查封装
- [ ] `react-native/src/theme/ThemeContext.tsx` — 暗色/亮色主题切换
- [ ] `react-native/src/theme/colors.ts` — 主题色值定义
- [ ] `react-native/src/chat/ChatScreen.tsx` — 聊天主页面，核心交互逻辑
- [ ] `react-native/src/chat/component/CustomMessageComponent.tsx` — 消息渲染组件
- [ ] `react-native/src/chat/component/CustomSendComponent.tsx` — 发送按钮组件
- [ ] `react-native/src/chat/component/EmptyChatComponent.tsx` — 空聊天页引导
- [ ] `react-native/src/chat/component/CustomChatFooter.tsx` — 聊天底部功能区
- [ ] `react-native/src/chat/component/HeaderTitle.tsx` — 聊天标题栏
- [ ] `react-native/src/chat/component/ModelSelectionModal.tsx` — 模型选择弹窗
- [ ] `react-native/src/chat/component/WebSearchSelectionModal.tsx` — 搜索引擎选择
- [ ] `react-native/src/api/bedrock-api.ts` — Bedrock API，主要的后端通信（流式对话）
- [ ] `react-native/src/api/bedrock-api-key.ts` — Bedrock API Key 模式
- [ ] `react-native/src/api/bedrock-api-key-image.ts` — Bedrock 图片生成
- [ ] `react-native/src/api/ollama-api.ts` — Ollama 本地模型 API
- [ ] `react-native/src/api/open-api.ts` — OpenAI / DeepSeek API
- [ ] `react-native/src/chat/util/BedrockMessageConvertor.ts` — 消息格式转换器
- [ ] `react-native/src/chat/component/markdown/Markdown.tsx` — Markdown 渲染入口
- [ ] `react-native/src/chat/component/markdown/CustomMarkdownRenderer.tsx` — 自定义渲染器
- [ ] `react-native/src/chat/component/markdown/Parser.tsx` — Markdown 解析器
- [ ] `react-native/src/chat/component/markdown/CustomTokenizer.ts` — 自定义分词器
- [ ] `react-native/src/chat/component/markdown/ChunkedCodeView.tsx` — 代码块渲染
- [ ] `react-native/src/chat/component/markdown/MermaidCodeRenderer.tsx` — Mermaid 图表渲染
- [ ] `react-native/src/chat/component/markdown/HtmlCodeRenderer.tsx` — HTML 预览渲染
- [ ] `react-native/src/settings/SettingsScreen.tsx` — 设置页面
- [ ] `react-native/src/settings/TokenUsageScreen.tsx` — Token 用量统计
- [ ] `react-native/src/prompt/PromptScreen.tsx` — System Prompt 管理
- [ ] `react-native/src/image/ImageGalleryScreen.tsx` — 图片画廊
- [ ] `react-native/src/app/CreateAppScreen.tsx` — 即时 Web App 创建
- [ ] `react-native/src/app/AIWebView.tsx` — WebView 桥接
- [ ] `react-native/src/history/CustomDrawerContent.tsx` — 侧边栏（历史记录列表）
- [ ] `react-native/src/history/HistoryGroupUtil.ts` — 历史分组工具
- [ ] `react-native/src/websearch/services/WebSearchOrchestrator.ts` — 搜索协调器（核心调度）
- [ ] `react-native/src/websearch/services/index.ts` — 搜索服务入口
- [ ] `react-native/src/websearch/services/IntentAnalysisService.ts` — 意图分析
- [ ] `react-native/src/websearch/providers/TavilyProvider.ts` — Tavily 搜索提供商
- [ ] `react-native/src/websearch/providers/GoogleProvider.ts` — Google 搜索提供商
- [ ] `react-native/src/websearch/types.ts` — 搜索类型定义
- [ ] `react-native/src/utils/ModelUtils.ts` — 模型工具（判断模型能力）
- [ ] `react-native/src/utils/ErrorUtils.ts` — 错误处理
- [ ] `react-native/src/chat/util/FileUtils.ts` — 文件处理
- [ ] `react-native/src/chat/util/DiffUtils.ts` — Diff 算法（App 代码编辑）
- [ ] `react-native/src/chat/service/VoiceChatService.ts` — 语音聊天服务
- [ ] `react-native/ios/Services/NovaSonicService.swift` — Amazon Nova Sonic 语音服务（iOS 原生）
- [ ] `react-native/ios/Services/AudioManager.swift` — 音频管理器
- [ ] `react-native/ios/Services/ConversationManager.swift` — 对话管理
- [ ] `react-native/ios/Modules/VoiceChat/VoiceChatModule.swift` — 语音聊天桥接模块
- [ ] `react-native/ios/Modules/FilePaste/FilePasteModule.m` — 文件粘贴桥接模块
- [ ] `server/src/main.py` — 后端入口，FastAPI 路由（流式对话、图片生成等）
- [ ] `server/src/image_nl_processor.py` — 图片自然语言处理
