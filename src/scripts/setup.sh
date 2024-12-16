#!/bin/bash

echo -e "\n=== Installing Global Dependencies ==="
npm install -g nodemon pm2

echo -e "\n=== Setting up environment variables ==="
if [ ! -f .env ]; then
    echo "Creating .env file from example..."
    cp src/env/.env.example .env
    echo ".env file created successfully."
else
    echo ".env file already exists."
fi

cd /workspaces/infra-devcontainer-aws-cdk-cicd-nodejs
rm -rf node_modules
rm -rf package-lock.json
npm install

echo -e "\n=== Installing Test Dependencies ==="
npm install --save-dev jest supertest
