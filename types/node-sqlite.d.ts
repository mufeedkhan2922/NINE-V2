declare module "node:sqlite" {
  export interface StatementSync {
    run(...params: unknown[]): unknown;

    get(
      ...params: unknown[]
    ): unknown;

    all(
      ...params: unknown[]
    ): unknown[];
  }

  export interface DatabaseSyncOptions {
    [key: string]: unknown;
  }

  export class DatabaseSync {
    constructor(
      location: string,
      options?: DatabaseSyncOptions,
    );

    exec(sql: string): void;

    prepare(
      sql: string,
    ): StatementSync;

    close(): void;
  }
}