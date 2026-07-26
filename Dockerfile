FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy project files
COPY . .

# Build the project
RUN npm run build

# Expose the port the app runs on
EXPOSE 5173

# Start the app
CMD ["npm", "run", "preview"]
