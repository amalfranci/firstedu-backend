/**
 * Jest configuration for firstedu-backend
 * Runs unit and integration tests for AI question generation
 */

export default {
    testEnvironment: 'node',
    transform: {},
    testMatch: ['tests/**/*.test.js', '**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
    collectCoverageFrom: [
        'src/services/**/*.js',
        '!src/services/**/*.cron.js',
        '!src/services/__tests__/**',
    ],
    coverageThreshold: {
        global: {
            branches: 60,
            functions: 60,
            lines: 60,
            statements: 60,
        },
        './src/services/correctnessPreAudit.service.js': {
            branches: 70,
            functions: 75,
            lines: 75,
            statements: 75,
        },
        './src/services/questionNumericVerify.service.js': {
            branches: 70,
            functions: 75,
            lines: 75,
            statements: 75,
        },
    },
    testTimeout: 900000,
    verbose: true,
};
