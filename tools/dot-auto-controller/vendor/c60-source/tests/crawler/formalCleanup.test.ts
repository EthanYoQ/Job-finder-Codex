import {describe,expect,it,vi} from "vitest";
import {runFormalCleanup} from "../../src/crawler/formalCleanup";
describe("formal cleanup aggregation",()=>{
  it("attempts file close, Prisma disconnect, and advisory release even when each fails",async()=>{const close=vi.fn(async()=>{throw new Error("close")}),disconnect=vi.fn(async()=>{throw new Error("disconnect")}),release=vi.fn(async()=>{throw new Error("release")});await expect(runFormalCleanup([{name:"file",run:close},{name:"prisma",run:disconnect},{name:"advisory",run:release}])).rejects.toSatisfy((error:AggregateError)=>error instanceof AggregateError&&error.errors.length===3);expect(close).toHaveBeenCalledOnce();expect(disconnect).toHaveBeenCalledOnce();expect(release).toHaveBeenCalledOnce();});
});
