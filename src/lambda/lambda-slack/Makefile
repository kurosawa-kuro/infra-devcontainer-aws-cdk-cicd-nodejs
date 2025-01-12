# Lambda Slack Notification Function
# ===========================

.PHONY: install package deploy clean

# Development
# ----------
install:
	npm install

clean:
	rm -f function.zip

# Build
# -----
package: clean
	zip -r function.zip index.js node_modules/

# Deployment
# ---------
deploy: install package
	aws lambda update-function-code --function-name slack-notification --zip-file fileb://function.zip | cat