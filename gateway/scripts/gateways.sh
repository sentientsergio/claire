#!/bin/bash
# Gateway control script for claire
# Usage: ./gateways.sh [install|start|stop|restart|status|logs] [dev|prod|all]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$HOME/Library/Logs/claire"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

DEV_PLIST="claire.gateway.dev.plist"
PROD_PLIST="claire.gateway.prod.plist"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}!${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if a gateway is running
is_running() {
    local label="claire.gateway.$1"
    launchctl list | grep -q "$label" 2>/dev/null
}

# Install plist files to LaunchAgents
install_gateways() {
    print_status "Installing gateway LaunchAgents..."
    
    # Create log directory
    mkdir -p "$LOG_DIR"
    print_success "Log directory: $LOG_DIR"
    
    # Build gateway first
    print_status "Building gateway..."
    cd "$GATEWAY_DIR"
    npm run build
    print_success "Gateway built"
    
    # Copy plist files
    cp "$GATEWAY_DIR/$DEV_PLIST" "$LAUNCH_AGENTS_DIR/"
    print_success "Installed $DEV_PLIST"
    
    cp "$GATEWAY_DIR/$PROD_PLIST" "$LAUNCH_AGENTS_DIR/"
    print_success "Installed $PROD_PLIST"
    
    echo ""
    print_success "Installation complete!"
    echo ""
    echo "Next steps:"
    echo "  Start dev gateway:  $0 start dev"
    echo "  Start prod gateway: $0 start prod"
    echo "  Start both:         $0 start all"
    echo ""
    echo "Note: prod gateway is set to auto-start on login."
    echo "      dev gateway must be started manually."
}

# Uninstall plist files
uninstall_gateways() {
    print_status "Uninstalling gateway LaunchAgents..."
    
    # Stop first
    stop_gateway "all"
    
    # Remove plist files
    rm -f "$LAUNCH_AGENTS_DIR/$DEV_PLIST"
    rm -f "$LAUNCH_AGENTS_DIR/$PROD_PLIST"
    
    print_success "Uninstalled gateway LaunchAgents"
}

# Start a gateway
start_gateway() {
    local env="$1"
    
    if [[ "$env" == "all" ]]; then
        start_gateway "dev"
        start_gateway "prod"
        return
    fi
    
    local plist="claire.gateway.${env}.plist"
    local plist_path="$LAUNCH_AGENTS_DIR/$plist"
    
    if [[ ! -f "$plist_path" ]]; then
        print_error "$env gateway not installed. Run: $0 install"
        return 1
    fi
    
    if is_running "$env"; then
        print_warning "$env gateway already running"
        return 0
    fi
    
    print_status "Starting $env gateway..."
    launchctl load "$plist_path"
    sleep 1
    
    if is_running "$env"; then
        print_success "$env gateway started"
    else
        print_error "$env gateway failed to start. Check logs: npm run logs:$env"
    fi
}

# Stop a gateway
stop_gateway() {
    local env="$1"
    
    if [[ "$env" == "all" ]]; then
        stop_gateway "dev"
        stop_gateway "prod"
        return
    fi
    
    local plist="claire.gateway.${env}.plist"
    local plist_path="$LAUNCH_AGENTS_DIR/$plist"
    
    if [[ ! -f "$plist_path" ]]; then
        print_warning "$env gateway not installed"
        return 0
    fi
    
    if ! is_running "$env"; then
        print_warning "$env gateway not running"
        return 0
    fi
    
    print_status "Stopping $env gateway..."
    launchctl unload "$plist_path" 2>/dev/null || true
    print_success "$env gateway stopped"
}

# Restart a gateway
restart_gateway() {
    local env="$1"
    
    if [[ "$env" == "all" ]]; then
        restart_gateway "dev"
        restart_gateway "prod"
        return
    fi
    
    print_status "Restarting $env gateway..."
    stop_gateway "$env"
    sleep 1
    start_gateway "$env"
}

# Show status
show_status() {
    echo ""
    echo "Gateway Status"
    echo "=============="
    
    for env in dev prod; do
        local plist_path="$LAUNCH_AGENTS_DIR/claire.gateway.${env}.plist"
        
        if [[ ! -f "$plist_path" ]]; then
            echo -e "$env: ${YELLOW}not installed${NC}"
        elif is_running "$env"; then
            echo -e "$env: ${GREEN}running${NC}"
        else
            echo -e "$env: ${RED}stopped${NC}"
        fi
    done
    
    echo ""
    echo "Log files:"
    echo "  dev:  $LOG_DIR/gateway.dev.log"
    echo "  prod: $LOG_DIR/gateway.prod.log"
    echo ""
}

# Show logs
show_logs() {
    local env="$1"
    local log_file
    
    if [[ "$env" == "dev" ]]; then
        log_file="$LOG_DIR/gateway.dev.log"
    elif [[ "$env" == "prod" ]]; then
        log_file="$LOG_DIR/gateway.prod.log"
    else
        print_error "Specify 'dev' or 'prod'"
        return 1
    fi
    
    if [[ -f "$log_file" ]]; then
        tail -f "$log_file"
    else
        print_error "Log file not found: $log_file"
    fi
}

# Main
case "${1:-}" in
    install)
        install_gateways
        ;;
    uninstall)
        uninstall_gateways
        ;;
    start)
        start_gateway "${2:-all}"
        ;;
    stop)
        stop_gateway "${2:-all}"
        ;;
    restart)
        restart_gateway "${2:-all}"
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "${2:-dev}"
        ;;
    *)
        echo "Gateway Control Script"
        echo "======================"
        echo ""
        echo "Usage: $0 <command> [dev|prod|all]"
        echo ""
        echo "Commands:"
        echo "  install     Install gateway LaunchAgents (run once)"
        echo "  uninstall   Remove gateway LaunchAgents"
        echo "  start       Start gateway(s)"
        echo "  stop        Stop gateway(s)"
        echo "  restart     Restart gateway(s)"
        echo "  status      Show gateway status"
        echo "  logs        Tail log file (dev or prod)"
        echo ""
        echo "Examples:"
        echo "  $0 install          # First-time setup"
        echo "  $0 start dev        # Start dev gateway"
        echo "  $0 restart all      # Restart both gateways"
        echo "  $0 logs prod        # Watch prod logs"
        echo ""
        ;;
esac
