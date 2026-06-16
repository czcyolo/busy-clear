# 公开发布目录建议

这个文件用于公开上传前检查仓库洁净度。

当前公开版目录建议放在：

```text
忙个明白/忙个明白-GitHub公开版/
```

这个目录在开发仓库中被 `.gitignore` 忽略。它是准备上传 GitHub 的干净副本，不是日常开发目录。

## 建议上传

```text
忙个明白/
  .gitignore
  AGENTS.md
  ATTRIBUTIONS.md
  CHANGELOG.md
  LICENSE
  PRIVACY.md
  README.md
  package.json
  package-lock.json
  electron.vite.config.ts
  tsconfig.json
  vitest.config.ts
  用户使用说明.md
  build/
    icon.icns
    icon.ico
    icon.png
    menu-bar-child-icon.png
    menu-bar-icon.png
  docs/
    PUBLIC_RELEASE_MANIFEST.md
  docs/assets/
    app-main-transparent.png
    app-working-transparent.png
    busy-clear-github-preview.mp4
    menu-bar.png
  src/
    main/
    preload/
    renderer/
    shared/
```

## 不建议上传

```text
node_modules/
out/
dist/
release/
coverage/
.vite/
截图/
素材/
docs/PROJECT_STATUS.md
.DS_Store
*.log
```

## 发布附件

以下文件建议放到 GitHub Release，不放进源码目录：

```text
忙个明白-0.1.0-arm64.dmg
忙个明白最终演示视频.mp4
```

README 使用 10MB 以内的压缩预览版：

```text
docs/assets/busy-clear-github-preview.mp4
```

## 后续更新流程

1. 在原开发项目继续开发、测试和打包。
2. 发版前把需要公开的源码、文档和展示素材同步到 `忙个明白-GitHub公开版/`。
3. 同步后检查公开目录，不应包含 `node_modules/`、`release/`、`out/`、`素材/`、`.DS_Store` 等文件。
4. 在公开目录里创建或更新 Git 提交，并推送到 GitHub。
5. 在 GitHub Release 里上传 `.dmg`、最终演示视频和版本说明。

## 公开前复核

- README 中没有本机绝对路径。
- 截图使用演示数据，不包含真实工作内容。
- `素材/` 不上传，除非逐个确认版权和用途。
- `release/` 不上传源码仓库，安装包放 GitHub Release。
- `docs/PROJECT_STATUS.md` 不上传公开版，因为它偏本地开发交接，不适合作为公开文档。
