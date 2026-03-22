

const nextConfig = {
  reactStrictMode: true,
  // Allow cross-origin requests from local backend
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
    ]
  },
}

export default nextConfig
