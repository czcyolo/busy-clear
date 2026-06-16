# 项目说明

这是“忙个明白”的桌面端项目，目标是帮助办公室用户低摩擦记录一天做过的工作，并导出可用于复盘或沟通的日报。

## 技术栈

- Electron：桌面壳、托盘、截图、本地文件能力
- React + TypeScript：界面与业务类型
- Vite / electron-vite：开发和构建
- Vitest：核心逻辑测试

## 常用命令

- 安装依赖：`npm install`
- 启动开发版：`npm run dev`
- 类型检查：`npm run typecheck`
- 运行测试：`npm test`
- 构建应用：`npm run build`
- 打包 Mac：`npm run dist:mac`
- 打包 Windows：`npm run dist:win`

## 工程约定

- 业务状态流转优先放在 `src/shared/`，方便测试。
- Electron 主进程负责系统能力：文件读写、截图、托盘、导出。
- React 渲染进程只负责界面交互，不直接读写本地文件。
- 第一版本地 JSON 保存，后续数据量增大时再迁移 SQLite。
- 同一时间只允许一个工作项处于计时中，避免日报统计重复。

## 完成标准

- 修改核心逻辑后运行 `npm test`。
- 修改类型或接口后运行 `npm run typecheck`。
- 修改界面后至少用 `npm run dev` 手动验证关键路径。

