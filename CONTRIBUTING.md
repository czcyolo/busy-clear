# Contributing

感谢你关注忙个明白。

这个项目还在早期阶段，最有价值的反馈通常来自真实使用场景：哪里不顺手、哪里记录不清楚、哪里影响了日常工作节奏。

## Before You Start

- Bug 请使用 GitHub Issue 的 Bug report 模板。
- 新功能建议请使用 Feature request 模板。
- 涉及隐私或安全的问题，请按 [SECURITY.md](SECURITY.md) 私下报告。

## Local Development

```bash
npm install
npm run dev
```

提交改动前建议运行：

```bash
npm run typecheck
npm test
```

## Pull Requests

请尽量让 PR 保持小而清晰，并说明：

- 改了什么
- 为什么需要改
- 如何验证

如果改动涉及截图、托盘、窗口层级或打包行为，请注明测试过的系统版本。
