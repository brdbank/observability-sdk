module.exports = {
  apps: [
    {
      name: 'api-gateway',
      cwd: '../api-gateway',
      script: 'dist/main.js',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'authentication-service',
      cwd: '../authentication-service',
      script: 'dist/main.js',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
