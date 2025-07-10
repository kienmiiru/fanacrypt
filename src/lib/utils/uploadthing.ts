import { UTApi } from "uploadthing/server";

const apiKeys = [
    process.env.UPLOADTHING_TOKEN_0,
    process.env.UPLOADTHING_TOKEN_1,
    process.env.UPLOADTHING_TOKEN_2,
    process.env.UPLOADTHING_TOKEN_3,
    process.env.UPLOADTHING_TOKEN_4,
];

export const utpApis = apiKeys.map(apiKey => new UTApi({ token: apiKey }));

