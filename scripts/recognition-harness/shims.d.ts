declare module '@nestjs/common' {
  export const Injectable: () => ClassDecorator;
  export const Module: (o: unknown) => ClassDecorator;
  export const Controller: (p?: string) => ClassDecorator;
  export const Post: (p?: string) => MethodDecorator;
  export const Param: (n?: string) => ParameterDecorator;
  export const Body: () => ParameterDecorator;
  export const UseGuards: (...g: unknown[]) => any;
  export const HttpCode: (c: number) => MethodDecorator;
  export const SetMetadata: (k: string, v: unknown) => any;
  export class Logger { constructor(c?: string); error(m: string, s?: string): void; warn(m: string): void; log(m: string): void }
  export const __logs: string[];
  export type CanActivate = any; export type ExecutionContext = any;
  export class HttpException { constructor(m: string, s: number) } export const HttpStatus: any;
}
declare module '@nestjs/mongoose' {
  export const InjectModel: (n: string) => ParameterDecorator;
  export const Prop: (o?: unknown) => PropertyDecorator;
  export const Schema: (o?: unknown) => ClassDecorator;
  export const SchemaFactory: { createForClass(c: unknown): any };
  export const MongooseModule: { forFeature(m: unknown[]): any };
}
declare module 'mongoose' {
  export namespace Types { class ObjectId { constructor(v?: unknown); toString(): string; equals(o: unknown): boolean; static isValid(v: unknown): boolean } }
  export type HydratedDocument<T> = T & { _id: Types.ObjectId };
  export interface Q { select(s: string): Q; lean<R = any>(): Promise<R | null> }
  export interface Model<T> {
    findOne(f: unknown): Q;
    create(d: unknown): Promise<T>;
    updateOne(f: unknown, u: unknown): Promise<{ matchedCount: number }>;
    exists(f: unknown): Promise<unknown>;
  }
}

declare module 'crypto' {
  export function createHash(a: string): { update(d: string): { digest(e: string): string } };
  export function randomBytes(n: number): { toString(e: string): string };
}
declare module '@nestjs/core' { export class Reflector { getAllAndOverride<T>(k: string, t: unknown[]): T } }
declare module 'express' { export type Request = any; export type Response = any }
