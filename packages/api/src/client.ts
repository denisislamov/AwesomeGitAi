import type {AppError, ReadEnvelope, ReadRequest, ReadResponse} from './generated';
export type WireResult = {Ok: ReadResponse} | {Err: AppError};
export type LocalTransport = (request: ReadEnvelope) => Promise<WireResult>;
/** Native adapter supplies the transport; browser code never opens the host socket. */
export class HostClient {
  constructor(private readonly transport: LocalTransport) {}
  async request(request: ReadRequest): Promise<ReadResponse> {
    const response = await this.transport({meta:{schema_version:1,request_id:crypto.randomUUID(),idempotency_key:null},request});
    if ('Err' in response) throw response.Err;
    return response.Ok;
  }
}
