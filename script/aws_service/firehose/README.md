以下にFirehose、S3、Glue、Athenaの設定を整理したドキュメントを作成します：

# アプリケーションログ分析基盤設定ドキュメント

## 1. Kinesis Firehose 設定
### ストリーム基本情報
- ストリーム名: `cdkjavascript01-stream`
- ソース: Direct PUT
- 宛先: Amazon S3
- ARN: ap-northeast-1:385559793418:deliverystream/cdkjavascript01-stream

### S3出力設定
- S3バケット: `cdkjavascript01-logs`
- プレフィックス: `log_raw_data/`
- バッファサイズ: 5 MiB
- バッファ間隔: 10秒
- S3バケットプレフィックス: `log_raw_data/`

## 2. Glueデータベースとテーブル設定
### データベース設定
```sql
CREATE DATABASE cdkjavascript01_application_logs;
```

### テーブル設定
```sql
CREATE EXTERNAL TABLE cdkjavascript01_application_logs.request_logs (
    method STRING,
    url STRING,
    status INT,
    response_time STRING,
    user_agent STRING,
    ip STRING,
    user_id INT,
    trace_id STRING,
    timestamp TIMESTAMP,
    source STRING,
    environment STRING
)
PARTITIONED BY (
    year STRING,
    month STRING,
    day STRING,
    hour STRING
)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES (
    'ignore.malformed.json' = 'true',
    'dots.in.keys' = 'false',
    'case.insensitive' = 'true'
)
STORED AS TEXTFILE
LOCATION 's3://cdkjavascript01-logs/log_raw_data/';
```

## 3. Glue Crawler設定
### クローラー基本設定
- クローラー名: `cdkjavascript01-logs-crawler`
- データソース: S3 バケット
- S3パス: `s3://cdkjavascript01-logs/log_raw_data/`
- 対象データベース: `cdkjavascript01_application_logs`

### クローラースケジュール
- 実行頻度: 必要に応じて設定（推奨：1時間ごと）

## 4. 動作確認用クエリ
### レコード数確認
```sql
SELECT COUNT(*) FROM cdkjavascript01_application_logs.request_logs;
```

### データサンプル確認
```sql
SELECT * FROM cdkjavascript01_application_logs.request_logs LIMIT 10;
```

## 5. 注意事項
1. パーティション構造は年/月/日/時間の階層構造
2. JSONの解析にはJsonSerDeを使用
3. タイムスタンプはTIMESTAMP型として定義
4. malformedなJSONは無視する設定
5. 大文字小文字を区別しない設定

## 6. 運用管理
- 新しいデータが追加されたら、Crawlerを実行して最新のパーティションを認識させる
- パーティションの手動更新が必要な場合は、MSCK REPAIR TABLEコマンドを使用
- ログデータの保持期間やパーティション管理方針を別途定める必要あり