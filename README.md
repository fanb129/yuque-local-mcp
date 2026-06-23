# yuque-local-mcp

本地语雀 MCP server，通过你自己的浏览器登录态访问语雀，不使用语雀 OpenAPI token。

设计目标：

- 只访问 `config.json` 里显式允许的知识库。
- 读取、新建、编辑文档都先做 URL 白名单校验。
- 打开页面后再读取语雀页面里的 `window.appData` 做二次校验。
- 搜索只搜本地缓存，不做语雀全站搜索。
- 写操作默认只把内容填进浏览器，要求人眼确认后再保存。

## 安装

```bash
npm install
npx playwright install chromium
npm run build
cp config.example.json config.json
```

编辑 `config.json`：

```json
{
  "allowedBooks": [
    {
      "name": "我的知识库",
      "origin": "https://www.yuque.com",
      "group": "your-space",
      "book": "your-book"
    }
  ]
}
```

知识库 URL 如果是：

```text
https://www.yuque.com/acme/frontend
```

那就是：

```json
{
  "origin": "https://www.yuque.com",
  "group": "acme",
  "book": "frontend"
}
```

如果知道 `bookId`，建议填上。MCP 会在页面加载后同时校验 `bookId`。

## 首次登录

启动 MCP 后调用：

```text
yuque_open_login
```

它会打开一个持久化 Chromium profile。你手动登录语雀后，后续工具复用这个登录态。

## Codex 配置

把 `config.codex.example.toml` 里的路径改成绝对路径，然后合并到：

```text
~/.codex/config.toml
```

读工具可以自动执行，写工具建议保持 `prompt`。

## Claude Code 配置

把 `.mcp.example.json` 复制成项目根目录的 `.mcp.json`，并修改绝对路径。

## 工具

- `yuque_allowed_books`：列出允许访问的知识库。
- `yuque_open_login`：打开浏览器登录语雀。
- `yuque_read_doc`：读取允许知识库内的文档并缓存。
- `yuque_get_toc`：读取允许知识库目录。
- `yuque_sync_book`：按目录同步最多 50 篇到本地缓存。
- `yuque_search_cache`：只搜索本地缓存。
- `yuque_create_doc`：在允许知识库中新建文档。
- `yuque_update_doc`：替换或追加允许知识库内文档内容。

## 写操作安全策略

默认配置：

```json
{
  "writeSafety": {
    "snapshotBeforeWrite": true,
    "requireHumanReviewInBrowser": true
  }
}
```

这表示：

- 编辑前会读取并保存原文快照。
- 新建/编辑只会把内容填进浏览器，不会自动点击保存。
- 你确认无误后，在语雀浏览器窗口里手动保存。

如果你确认要自动尝试保存，可以改成：

```json
{
  "writeSafety": {
    "snapshotBeforeWrite": true,
    "requireHumanReviewInBrowser": false
  }
}
```

不建议第一天就关闭人工确认。

## 重要限制

这是浏览器自动化方案，不是语雀官方 API。语雀 UI 改版、登录过期、验证码、编辑器粘贴行为变化都可能影响写入成功率。

第一版没有开放删除、权限修改、分享公开、批量移动等危险操作。
