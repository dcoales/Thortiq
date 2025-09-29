declare module "@aws-sdk/client-s3" {
  export class S3Client {
    constructor(config: { region?: string });
    send(command: unknown): Promise<unknown>;
  }
  export class GetObjectCommand {
    constructor(input: unknown);
  }
  export class PutObjectCommand {
    constructor(input: unknown);
  }
}
