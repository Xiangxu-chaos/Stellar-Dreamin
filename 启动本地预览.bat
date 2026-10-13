@echo off
chcp 65001 >nul
title 六级单词卡片 · 本地服务器
echo ============================================================
echo   六级单词 · 兴趣化记忆卡片  ——  本地预览
echo ============================================================
echo.
echo 注意：本项目用 fetch() 加载 JSON 数据，直接双击 index.html
echo       会被 Chrome 的 file:// 安全策略拦住（CORS 报错、白屏）。
echo       必须通过本地 HTTP 服务器打开，脚本已为你启动。
echo.
echo 浏览器打开后：
echo   1. 收藏几个词，顶部数字应变成 1、2、3
echo   2. 切到「收藏夹」标签，数字和列表都应保持
echo   3. 按 F5 刷新，收藏依然在（真实浏览器不会重置 localStorage）
echo.
echo 关闭本窗口即停止服务器。
echo ------------------------------------------------------------
echo.

cd /d "%~dp0"
start "" http://localhost:8099/index.html

REM 优先用 Python（本机已装），否则退到 Node
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8099
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server 8099
  goto :eof
)
where node >nul 2>nul
if %errorlevel%==0 (
  node -e "const h=require('http'),f=require('fs'),p=require('path');const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};h.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const fp=p.join(process.cwd(),u);f.readFile(fp,(e,d)=>{if(e){s.writeHead(404);s.end('404');return}s.writeHead(200,{'Content-Type':T[p.extname(fp).toLowerCase()]||'application/octet-stream'});s.end(d)})}).listen(8099,()=>console.log('http://localhost:8099/index.html'))"
  goto :eof
)
echo [错误] 没有找到 python 或 node，无法启动本地服务器。
echo        请安装 Python（https://www.python.org/downloads/）后重试。
pause
