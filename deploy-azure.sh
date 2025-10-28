#!/bin/bash

# Azure VM Production Deployment Script
# Run this script on your Azure VM to set up the production environment

set -e  # Exit on any error

echo "🚀 Starting ClientHubAI Production Deployment on Azure VM..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root. Please run as a regular user with sudo privileges."
   exit 1
fi

# Update system packages
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
print_status "Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
print_status "Installing PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib

# Install PM2 for process management
print_status "Installing PM2..."
sudo npm install -g pm2

# Install Nginx
print_status "Installing Nginx..."
sudo apt install -y nginx

# Install SSL certificate tool
print_status "Installing Certbot for SSL..."
sudo apt install -y certbot python3-certbot-nginx

# Create application directory
print_status "Creating application directory..."
sudo mkdir -p /var/www/clienthubai
sudo chown $USER:$USER /var/www/clienthubai

# Create uploads directory
print_status "Creating uploads directory..."
sudo mkdir -p /var/www/clienthubai/uploads
sudo chown $USER:$USER /var/www/clienthubai/uploads
sudo chmod 755 /var/www/clienthubai/uploads

# Create log directory
print_status "Creating log directory..."
sudo mkdir -p /var/log/clienthubai
sudo chown $USER:$USER /var/log/clienthubai

# Create backup directory
print_status "Creating backup directory..."
sudo mkdir -p /var/backups/clienthubai
sudo chown $USER:$USER /var/backups/clienthubai

# Setup PostgreSQL database
print_status "Setting up PostgreSQL database..."
sudo -u postgres psql << EOF
CREATE DATABASE clienthubai_prod;
CREATE USER clienthubai_user WITH PASSWORD 'ClientHubAI_2025_Secure!';
GRANT ALL PRIVILEGES ON DATABASE clienthubai_prod TO clienthubai_user;
ALTER USER clienthubai_user CREATEDB;
\q
EOF

# Configure PostgreSQL for production
print_status "Configuring PostgreSQL..."
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = 'localhost'/" /etc/postgresql/*/main/postgresql.conf
sudo systemctl restart postgresql
sudo systemctl enable postgresql

# Create PM2 ecosystem file
print_status "Creating PM2 configuration..."
cat > /var/www/clienthubai/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'clienthubai',
    script: 'dist/index.js',
    cwd: '/var/www/clienthubai',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: '/var/log/clienthubai/error.log',
    out_file: '/var/log/clienthubai/out.log',
    log_file: '/var/log/clienthubai/combined.log',
    time: true,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024'
  }]
};
EOF

# Create Nginx configuration
print_status "Creating Nginx configuration..."
sudo tee /etc/nginx/sites-available/clienthubai << 'EOF'
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;  # Replace with your actual domain

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

    # File upload size limit
    client_max_body_size 50M;

    # Serve static files
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Serve uploaded files directly
    location /uploads/ {
        alias /var/www/clienthubai/uploads/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/clienthubai /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# Create systemd service for PM2
print_status "Creating PM2 systemd service..."
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME

# Create backup script
print_status "Creating backup script..."
cat > /var/www/clienthubai/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/clienthubai"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="clienthubai_backup_$DATE.sql"

# Database backup
pg_dump -h localhost -U clienthubai_user -d clienthubai_prod > "$BACKUP_DIR/$BACKUP_FILE"

# Compress backup
gzip "$BACKUP_DIR/$BACKUP_FILE"

# Remove old backups (keep last 30 days)
find $BACKUP_DIR -name "clienthubai_backup_*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_FILE.gz"
EOF

chmod +x /var/www/clienthubai/backup.sh

# Create cron job for daily backups
print_status "Setting up daily backups..."
(crontab -l 2>/dev/null; echo "0 2 * * * /var/www/clienthubai/backup.sh") | crontab -

# Create health check script
print_status "Creating health check script..."
cat > /var/www/clienthubai/health-check.sh << 'EOF'
#!/bin/bash
# Health check script for ClientHubAI

# Check if application is running
if ! curl -f http://localhost:5000/health > /dev/null 2>&1; then
    echo "Application health check failed. Restarting..."
    pm2 restart clienthubai
fi

# Check database connection
if ! pg_isready -h localhost -U clienthubai_user -d clienthubai_prod > /dev/null 2>&1; then
    echo "Database connection failed. Restarting PostgreSQL..."
    sudo systemctl restart postgresql
fi
EOF

chmod +x /var/www/clienthubai/health-check.sh

# Create cron job for health checks
(crontab -l 2>/dev/null; echo "*/5 * * * * /var/www/clienthubai/health-check.sh") | crontab -

print_status "✅ Production environment setup completed!"
print_status "📋 Next steps:"
echo "1. Copy your application code to /var/www/clienthubai/"
echo "2. Copy .env.production to /var/www/clienthubai/.env"
echo "3. Update the .env file with your actual values"
echo "4. Run: cd /var/www/clienthubai && npm install"
echo "5. Run: npm run build"
echo "6. Run: npm run db:push"
echo "7. Run: pm2 start ecosystem.config.js"
echo "8. Run: sudo systemctl restart nginx"
echo "9. Setup SSL certificate: sudo certbot --nginx -d your-domain.com"
echo ""
print_warning "Don't forget to:"
echo "- Replace 'your-domain.com' with your actual domain"
echo "- Update firewall rules to allow HTTP (80) and HTTPS (443)"
echo "- Configure your domain's DNS to point to this server"
echo "- Update the .env file with secure passwords and API keys"
