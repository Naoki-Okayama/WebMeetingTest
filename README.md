# カメラ・マイク テスト

Web 会議の開始前に、カメラ映像とマイク音声（入力レベル・録音・再生）を手軽に確認できる静的 Web サイト。
HTML・バニラ JavaScript・ローカル配置の PicoCSS のみで構成し、ビルド不要かつ完全オフラインで動作する。

## 公開ページ（GitHub Pages）

- https://naoki-okayama.github.io/WebMeetingTest/

## プライバシー・セキュリティ（ローカル完結・外部送信なし）

- **ローカル処理のみ**: カメラ映像・マイク音声・録音データはすべてブラウザ内のローカルメモリ上でのみ処理し、外部サーバーや第三者サービスへ一切送信しない。
- **外部通信なし**: 外部 CDN・アナリティクス・トラッキングスクリプトは不使用。オフライン環境でも動作する。
- **保存データ**: `localStorage` に保存するのはテーマ設定（`light` / `dark`）のみ。映像・音声は永続保存せず、再録音時やページ離脱時にメモリから解放する。
- **明示的な起動**: カメラおよびマイクは、ユーザーが開始ボタンを押下した場合にのみブラウザの権限確認を経て起動する。

## 主な機能

- **カメラテスト**: リアルタイム映像プレビュー、カメラの開始/停止、接続カメラの切替
- **マイクテスト**: マイクの開始/停止、接続マイクの切替、リアルタイム入力レベルメーター
- **録音・再生テスト**: マイク稼働中の録音/停止（最大 60 秒で自動停止）、`<audio>` プレイヤーによる即時再生
- **独立動作**: カメラ・マイクの権限取得を分離しており、片方のデバイスが無くても他方をテスト可能
- **テーマ切替**: OS のライト/ダーク設定への自動追従および手動切替スイッチ

## 動作要件

- **プロトコル**: HTTPS または `localhost`（ブラウザの `getUserMedia` API のセキュアコンテキスト要件）
- **対象ブラウザ**: Chrome / Edge / Safari / Firefox の最新安定版

## ローカルでの起動方法

`file://` 直接アクセスではセキュリティ制限によりカメラ・マイク API が動作しないため、ローカル HTTP サーバー経由で開く。

```powershell
python -m http.server 8000
```

起動後、ブラウザで `http://localhost:8000` へアクセスする。

## サードパーティライセンス

本プロジェクトはスタイルシートとして [Pico CSS](https://picocss.com/)（`css/pico.min.css`、v2.1.1）を同梱している。Pico CSS は MIT License の下で配布されている。

```text
MIT License

Copyright (c) 2019-2025 Pico CSS (https://picocss.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
