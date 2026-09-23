const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Public execution API base URL
const PISTON_API_URL = 'https://emkc.org/api/v2/piston/execute';

// Mapping language names to Piston language identifiers and versions
const LANGUAGE_CONFIG = {
    python: { language: 'python', version: '3.10.0' },
    javascript: { language: 'javascript', version: '18.15.0' },
    java: { language: 'java', version: '15.0.2' },
    cpp: { language: 'cpp', version: '10.2.0' }
};

app.post('/api/v1/execute', async (req, res) => {
    const startTime = Date.now();
    const { language, code, testCases } = req.body;

    const langConfig = LANGUAGE_CONFIG[language];
    if (!langConfig) {
        return res.status(400).json({
            overallStatus: 'ERROR',
            results: [],
            executionTimeMs: 0,
            error: 'Unsupported language'
        });
    }

    try {
        let overallStatus = 'ACCEPTED';
        const results = [];

        // Execute code against each test case via Piston API
        for (const tc of testCases) {
            const response = await fetch(PISTON_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    language: langConfig.language,
                    version: langConfig.version,
                    files: [
                        {
                            content: code
                        }
                    ],
                    stdin: tc.input || ''
                })
            });

            const data = await response.json();

            // Handle compile/runtime errors returned by Piston
            if (data.run?.code !== 0 || data.compile?.code !== 0) {
                const errorOutput = data.compile?.stderr || data.run?.stderr || 'Execution Error';
                results.push({
                    status: 'ERROR',
                    expectedOutput: tc.expectedOutput ? tc.expectedOutput.trim() : '',
                    actualOutput: '',
                    errorOutput: errorOutput.trim()
                });
                overallStatus = 'ERROR';
                continue;
            }

            const actualOutput = (data.run.stdout || '').trim();
            const expectedOutput = (tc.expectedOutput || '').trim();

            let status = 'ACCEPTED';
            if (actualOutput !== expectedOutput) {
                status = 'WRONG_ANSWER';
                if (overallStatus === 'ACCEPTED') {
                    overallStatus = 'WRONG_ANSWER';
                }
            }

            results.push({
                status: status,
                expectedOutput: expectedOutput,
                actualOutput: actualOutput,
                errorOutput: (data.run.stderr || '').trim()
            });
        }

        res.json({
            overallStatus: overallStatus,
            results: results,
            executionTimeMs: Date.now() - startTime
        });

    } catch (error) {
        console.error('Piston Execution Error:', error);
        res.status(500).json({
            overallStatus: 'SERVER_ERROR',
            results: [],
            executionTimeMs: Date.now() - startTime
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 API-based Code Execution Backend running on http://localhost:${PORT}`);
});