#!/bin/bash

echo -e "\n=== Installing Development Dependencies ==="
npm install nodemon --global

@if [ ! -f .env ]; then \
    echo "Creating .env file from example..."; \
    cp src/env/.env.example .env; \
    echo ".env file created successfully."; \
else \
    echo ".env file already exists."; \
fi