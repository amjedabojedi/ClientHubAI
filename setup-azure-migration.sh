#!/bin/bash

# Azure Blob Storage Migration Setup Script
# Run this script to install dependencies and migrate documents

set -e

echo "🚀 Setting up Azure Blob Storage Migration..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

# Install Azure Blob Storage SDK
print_status "Installing Azure Blob Storage SDK..."
npm install @azure/storage-blob

# Check if downloaded-documents directory exists
if [ ! -d "downloaded-documents" ]; then
    print_error "downloaded-documents directory not found!"
    print_error "Please ensure you have the downloaded documents folder"
    exit 1
fi

# Check if download-report.json exists
if [ ! -f "download-report.json" ]; then
    print_error "download-report.json not found!"
    print_error "Please ensure you have the download report file"
    exit 1
fi

# Count files to migrate
file_count=$(ls downloaded-documents/ | wc -l)
print_status "Found $file_count files to migrate"

# Check if .env file exists and has Azure configuration
if [ ! -f ".env" ]; then
    print_warning ".env file not found. Creating one..."
    cat > .env << 'EOF'
NODE_ENV=production
DATABASE_URL=postgresql://clienthubai_user:YourSecurePassword123!@localhost:5432/clienthubai_prod
OPENAI_API_KEY=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
JWT_SECRET=4f9b2c8e7a1d5f6g9h3j2k0l8m4n7p6q
STRIPE_SECRET_KEY=test_key_12345
AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=clienthubai;AccountKey=pj6JB1RCE7oE3C3txzOU0JYXwMnSECxCoKsMBzFFEw6bmGuZstj3thwxAREQ7okSlsu8W9o7ETgc+AStMxDJnw==;EndpointSuffix=core.windows.net"
AZURE_BLOB_CONTAINER_NAME="documents"
EOF
else
    # Check if Azure configuration exists in .env
    if ! grep -q "AZURE_STORAGE_CONNECTION_STRING" .env; then
        print_warning "Adding Azure configuration to .env file..."
        echo "" >> .env
        echo "AZURE_STORAGE_CONNECTION_STRING=\"DefaultEndpointsProtocol=https;AccountName=clienthubai;AccountKey=pj6JB1RCE7oE3C3txzOU0JYXwMnSECxCoKsMBzFFEw6bmGuZstj3thwxAREQ7okSlsu8W9o7ETgc+AStMxDJnw==;EndpointSuffix=core.windows.net\"" >> .env
        echo "AZURE_BLOB_CONTAINER_NAME=\"documents\"" >> .env
    fi
fi

# Make migration script executable
chmod +x migrate-to-azure-blob.mjs

print_status "Setup completed successfully!"
print_status "Ready to migrate $file_count documents to Azure Blob Storage"

echo ""
print_status "Next steps:"
echo "1. Run the migration script:"
echo "   node migrate-to-azure-blob.mjs"
echo ""
echo "2. Check the migration report:"
echo "   cat azure-migration-report.json"
echo ""
echo "3. Check the migration log:"
echo "   cat azure-migration-log.txt"
echo ""

# Ask if user wants to run migration now
read -p "Do you want to run the migration now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Starting migration..."
    node migrate-to-azure-blob.mjs
else
    print_status "Migration ready to run when you're ready!"
fi
