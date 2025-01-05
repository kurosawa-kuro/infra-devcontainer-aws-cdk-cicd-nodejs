package:
	zip -r function.zip index.js node_modules/

deploy: package
	aws lambda update-function-code --function-name slackNotification --zip-file fileb://function.zip | cat

.PHONY: package deploy