import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// 许可证声明：随打包产物一同分发，满足 MIT「版权声明与许可声明须包含在所有副本中」
// 以及 Apache-2.0 的署名要求。完整全文见仓库根目录 THIRD-PARTY-NOTICES.md。
const LEGAL_BANNER = `/*!
 * Bingmail UI bundle — Copyright (c) 2026 ChaBingovo — MIT License
 *
 * Bundled third-party components:
 *  - SolidJS v1.9.13        — MIT        — Copyright (c) 2016-2025 Ryan Carniato
 *  - seroval / seroval-plugins — MIT      — Copyright (c) 2025 Alexis Munsayac
 *  - csstype                — MIT        — Copyright (c) 2017-2018 Fredrik Nicol
 *  - DOMPurify v3.4.5       — Apache-2.0 — Copyright (c) Cure53 and other contributors
 *
 * MIT License
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Full license texts: THIRD-PARTY-NOTICES.md
 */`;

export default defineConfig({
  plugins: [solid()],
  // 保留依赖自带 @license 标记的注释（如 DOMPurify 的 banner）。
  esbuild: {
    legalComments: "inline",
  },
  build: {
    rollupOptions: {
      output: {
        banner: LEGAL_BANNER,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8788",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
