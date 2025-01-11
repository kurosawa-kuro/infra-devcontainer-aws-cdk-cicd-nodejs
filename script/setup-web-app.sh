#!/bin/bash

#######################################
# 1. Configuration Management
#######################################
declare -r SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
declare -r NPM_GLOBAL_DIR="$HOME/.npm-global"
declare -r ENV_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/.env"
declare -r TIMESTAMP=$(date +%Y%m%d_%H%M%S)
declare -r BACKUP_DIR="$SCRIPT_DIR/config"

# スクリプトの動作モード設定
declare -r SKIP_NPM_SETUP=false          # NPMセットアップをスキップする場合はtrue

#######################################
# 2. Logging System
#######################################
declare -r LOG_INFO="\033[0;34m"  # Blue color for info
declare -r LOG_ERROR="\033[0;31m" # Red color for errors
declare -r LOG_RESET="\033[0m"    # Reset color

log_info() {
    echo -e "${LOG_INFO}\n=== $1 ===${LOG_RESET}"
}

log_error() {
    echo -e "${LOG_ERROR}Error: $1${LOG_RESET}"
    exit 1
}

#######################################
# 3. NPM Environment Manager
#######################################
setup_npm_environment() {
    setup_npm_global
    install_required_packages
}

setup_npm_global() {
    if [ ! -d "$NPM_GLOBAL_DIR" ]; then
        log_info "Creating npm global directory"
        mkdir "$NPM_GLOBAL_DIR"
        npm config set prefix "$NPM_GLOBAL_DIR"
        configure_npm_profile
    fi
    export PATH="$NPM_GLOBAL_DIR/bin:$PATH"
    export NPM_CONFIG_PREFIX="$NPM_GLOBAL_DIR"
}

configure_npm_profile() {
    if ! grep -q "NPM_CONFIG_PREFIX" "$HOME/.profile"; then
        {
            echo "export PATH=$NPM_GLOBAL_DIR/bin:\$PATH"
            echo "export NPM_CONFIG_PREFIX=$NPM_GLOBAL_DIR"
        } >> "$HOME/.profile"
    fi
}

install_required_packages() {
    declare -a packages=("nodemon" "pm2")
    for package in "${packages[@]}"; do
        install_global_package "$package"
    done
}

install_global_package() {
    local package_name=$1
    if ! command -v "$package_name" &> /dev/null; then
        log_info "Installing $package_name globally"
        npm install -g "$package_name" || sudo npm install -g "$package_name"
        verify_package_installation "$package_name"
    else
        echo "$package_name is already installed"
    fi
}

verify_package_installation() {
    local package_name=$1
    if ! command -v "$package_name" &> /dev/null; then
        log_error "Failed to install $package_name. Please check permissions and try again."
    fi
}

#######################################
# 4. Environment File Manager
#######################################
manage_env_file() {
    backup_existing_env
    create_new_env
    update_credentials
}

backup_existing_env() {
    if [ -f .env ]; then
        local backup_file="$BACKUP_DIR/.env.backup_$TIMESTAMP"
        log_info "Backing up existing .env file"
        cp .env "$backup_file"
        echo "Backup created at $backup_file"
    fi
}

create_new_env() {
    log_info "Creating .env file from example"
    cp "$SCRIPT_DIR/config/.env.example" .env
    echo ".env file created/updated successfully."
}

check_aws_sdk_dependencies() {
    log_info "Checking AWS SDK dependencies"
    if ! npm list @aws-sdk/client-secrets-manager --json | grep -q "client-secrets-manager"; then
        log_info "Installing @aws-sdk/client-secrets-manager"
        npm install --save @aws-sdk/client-secrets-manager
    fi
}

update_credentials() {
    local source_file="/home/ec2-user/secret/from"
    local env_file="$(cd "$SCRIPT_DIR/.." && pwd)/.env"
    
    
    log_info "Updating credentials using update-key.js"
    if ! node "$SCRIPT_DIR/amazon-linux-2023/update-key.js"; then
        log_error "Failed to update credentials using update-key.js"
    fi
    
    chmod 600 "$env_file"
}

#######################################
# 5. Database Manager
#######################################
setup_database() {
    log_info "Setting up Prisma"
    npx prisma generate

    if [ "$NODE_ENV" != "production" ]; then
        run_database_migrations
    fi
}

run_database_migrations() {
    log_info "Running database migrations"
    npx prisma migrate dev
    log_info "Running database seeder"
    npm run db:seed
}

#######################################
# 6. Project Dependencies Manager
#######################################
setup_project_dependencies() {
    log_info "Installing Project Dependencies"
    rm -rf node_modules package-lock.json
    npm install --no-fund --no-audit
}

#######################################
# Main Execution Flow
#######################################
main() {
    log_info "Starting Web App Setup"
    
    if [ "$SKIP_NPM_SETUP" = false ]; then
        setup_npm_environment
        setup_project_dependencies
    else
        log_info "Skipping NPM setup and dependencies installation"
    fi
    
    manage_env_file
    setup_database
    
    log_info "Setup completed successfully"
}

# Script execution
main 