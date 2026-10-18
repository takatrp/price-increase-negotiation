# データ出典・更新手順

最終確認：2026年10月19日（日本時間）、r50。

正本は pref_cost_data.json、cpi_monthly_2025base.json、cpi_monthly_tax_adjusted.json です。公表日・対象期間・確認日を区別します。未確認の都道府県別CPI・賃上げ率は null のまま全国参考値を使用し、自社の手入力値は上書きしません。

## 更新差分

|項目|更新前|今回の更新・確認結果|
|---|---|---|
|全国コアCPI・前年同月比|2026年6月、1.6％|2026年8月、1.7％（9月18日公表）|
|通常CPI月次接続指数|1970年1月～2026年6月、678か月|7・8月追加で680か月。参考指数102.108、102.047。既存月は変更なし|
|消費税調整済CPI|2020年基準、1990年1月～2019年12月|同期間の2025年基準公式参考指数へ全360か月を入替え。端点91.9→82.6、100.6→90.5|
|春闘賃上げ率|2026年最終、4.69％・12,866円|公式最終集計と再照合し維持|
|佐賀最低賃金|答申・指定日設定、1,095円|10月2日の官報公示を確認、2026年11月15日発効の確定額へ移行|
|熊本最低賃金|答申・指定日設定、1,092円|10月5日の官報公示を確認、2026年12月1日発効の確定額へ移行|
|沖縄最低賃金|答申・指定日設定、1,086円|10月5日の官報公示を確認、2026年12月2日発効の確定額へ移行|
|他44都道府県|2026年度確定額・個別発効日|金額・日付を維持し、公式チェック表と再照合|
|全国加重平均|全件確定の2025年度1,121円|全47件確定確認後、2026年度改定後の公式公表値1,177円（+56円）を収録|

1,177円は**2026年度改定後の全国加重平均**です。10月19日の現行適用平均や全国同日発効を意味しません。[確認時点の公式チェック表照合結果](docs/data-update-2026-10-19.json)に47地域の現行額・改定後額・発効日を記録しました。

## 消費者物価指数（CPI）

- 公表主体：総務省統計局。系列は2025年基準、全国「生鮮食品を除く総合」。東京都区部速報や総合指数と区別します。
- 最新：2026年8月（9月18日公表）、公式前年同月比1.7％、公表指数102.0、小数第3位参考指数102.047。
- [8月分詳細結果表（e-Stat）](https://www.e-stat.go.jp/stat-search/files?layout=datalist&lid=000001490251&page=1)、[統計局最新結果](https://www.stat.go.jp/data/cpi/sokuhou/tsuki/index-z.html)、[結果・参考指数の入口](https://www.stat.go.jp/data/cpi/1.html)
- [長期時系列・全国中分類指数](https://www.e-stat.go.jp/stat-search/files?stat_infid=000040482943)、[CSV](https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040482943&fileKind=1)、[小数第3位全国参考指数CSV](https://www.stat.go.jp/data/cpi/2025/csv/zmi2025aa.csv)
- 9月全国値は未公表です。[公式予定](https://www.stat.go.jp/data/kouhyou/e-stat_cpi.xml)では10月23日8時30分公表予定。推測・補間していません。

累積上昇率は（最新月指数÷基準月指数−1）×100。1970年1月～2024年12月は小数第1位公表接続指数、2025年1月以降は小数第3位参考指数を使用します。公式前年同月比は公表値を転記し、接続指数からの再計算で置き換えません。旧historic.html・旧e-Stat一覧lid=000001488144は今回取得不可だったため、取得できる公式結果・統計表URLへ更新しました。

### 消費税調整済指数

- [2025年基準公式Excel](https://www.stat.go.jp/data/cpi/2025/zuhyou/2025taxadj.xlsx)、[作成方法](https://www.stat.go.jp/data/cpi/2015/pdf/2015taxadj.pdf)
- 1990年1月～2019年12月の公式参考指数。同じ系列内の比率を使い、2019年12月で通常CPIに接続します。2020年1月以降は通常CPIの比率を使用し、基準年の異なる指数値を直接除算しません。
- 確認日10月19日。明示された公表日は確認できなかったため推測して追加していません。参考指数は一律の税率調整であり、実際の課税状況と完全には一致しません。

再生成コマンド（列番号を固定せず系列名で照合）：

~~~powershell
node scripts/build-cpi-monthly.mjs <長期CSV> <小数第3位CSV> cpi_monthly_2025base.json --updated YYYY-MM-DD --latest-official-yoy N.N --publication-date YYYY-MM-DD --accessed-date YYYY-MM-DD
node scripts/build-cpi-tax-adjusted.mjs --input <2025taxadj.xlsx> --accessed-date YYYY-MM-DD
~~~

pref_cost_data.json の最新月・前年比・出典も同時に更新します。基準改定時は旧基準を混在させず公式系列で全期間を入れ替えます。

## 春闘賃上げ率

[連合2026春季生活闘争・第7回（最終）回答集計](https://www.jtuc-rengo.or.jp/activity/roudou/shuntou/2026/yokyu_kaito/kaito/press_no7.pdf)。7月3日公表・7月1日集計、10月19日再確認。300人未満の中小組合、平均賃金方式、組合員数による加重平均、定昇相当込みの12,866円・4.69％を維持します。賃上げ分が明確な組合の3.51％や全規模5.01％とは別指標です。自社人件費率の代用や最低賃金との単純加算はしません。

## 地域別最低賃金

- [厚生労働省全国一覧](https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/minimumichiran/)、[全国PDF](https://www.mhlw.go.jp/content/11200000/001753404.pdf)、[公式チェック表](https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php)
- [佐賀10月2日正式資料](https://jsite.mhlw.go.jp/saga-roudoukyoku/content/contents/002839608.pdf)：9月18日改正決定、10月2日官報公示、11月15日発効。
- [熊本10月5日正式資料](https://jsite.mhlw.go.jp/kumamoto-roudoukyoku/content/contents/002838514.pdf)：10月5日官報公示、12月1日発効。決定日を公示日と同一とは推定しません。
- [沖縄10月5日正式資料](https://jsite.mhlw.go.jp/okinawa-roudoukyoku/content/contents/002840324.pdf)：9月24日改正決定、10月5日官報公示、12月2日発効。
- [2026年度照合記録](docs/minimum-wage-2026-sources.json)に47都道府県の出典・公示日・確認日を収録。全国PDFの「答申された改定額」という列名だけで確定とは判定せず、既存確認済み44件に上記3件の正式公示確認を追加しました。

10月19日の佐賀は1,030円、熊本1,034円、沖縄1,023円です。「本日時点」は日本時間の本日以下で最新の発効日の確定額を採用。「改定後」は将来確定額も比較しますが、画面・案内文・面談トーク・根拠メモ・印刷・Wordの参考データに発効予定と明記します。日付変更時と画面復帰時の再計算、下書き・手入力・編集中文面の保護を維持します。

3県は保留一覧から削除して2026年度確定履歴へ移行しました。旧版・カスタムJSONの指定日設定機能は保持し、独立したテスト用データで回帰検証します。最終公示と利用者設定額を重複させません。価格決定月途中の最低賃金変更は、年月だけでは基準額を確定せず正確な日付を求めます。

2002～2025年度の検証済み履歴は維持。旧2026年度改定状況Excel（001753407.xlsx）は今回404で取得不可でした。以前記録された6県（秋田・福島・群馬・徳島・熊本・大分）の前年発効年不整合は推測で直さず、2026年度額・日付を今回取得できたPDF・チェック表・労働局資料で確認しました。元の2025年度履歴Excelの出典と以前の確認日は保持しています。

本データは地域別最低賃金です。[特定（産業別）最低賃金も適用される場合は高い額を使用](https://saiteichingin.mhlw.go.jp/point/page_point_class.html)してください。

## 検証

~~~powershell
node scripts/validate-data.mjs
$env:TZ='UTC'; node scripts/test-minimum-wage.mjs
$env:TZ='Asia/Tokyo'; node scripts/test-minimum-wage.mjs
$env:TZ='America/Los_Angeles'; node scripts/test-minimum-wage.mjs
~~~

現行額・将来確定額、発効前日・当日、日本時間0時、過去履歴・月途中の曖昧さ、CPIの連続性・基準・系列、税抜計算、手入力・下書き・編集中文面保護を検証。Windows改行差による検証失敗は検証スクリプト側で正規化しました。
