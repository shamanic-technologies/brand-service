import swaggerAutogen from 'swagger-autogen';
import path from 'path';

const doc = {
  info: {
    title: 'Brand Service API',
    description: 'Microservice for managing brand information, sales profiles, media assets, organization data, and AI-powered content analysis.',
    version: '1.0.0',
  },
  host: process.env.SERVICE_URL?.replace(/^https?:\/\//, '') || 'localhost:3005',
  schemes: process.env.SERVICE_URL?.startsWith('https') ? ['https'] : ['http'],
  securityDefinitions: {
    apiKey: {
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
      description: 'Service-to-service API key',
    },
  },
  security: [{ apiKey: [] }],
};

const outputFile = path.resolve(__dirname, '../openapi.json');
const routes = [
  path.resolve(__dirname, '../src/index.ts'),
];

swaggerAutogen({ openapi: '3.0.0' })(outputFile, routes, doc).then(() => {
  console.log('OpenAPI spec generated at openapi.json');
});
