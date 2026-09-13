import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { FirebaseService } from '../firebase/firebase.service';
import { PricingService } from '../pricing/pricing.service';
import { ServiceAreaService } from '../service-area/service-area.service';
import type { MerchantContext } from '../common/types/merchant-context';
// These are unit tests: never initialize Firebase or production credentials.
jest.mock('../firebase/firebase.service', () => ({ FirebaseService: class {} }));

const merchant: MerchantContext = {merchantId:'shop',status:'approved',displayName:'Shop',ownerUid:'owner'};
function fixture(order: Record<string, unknown>, bid: Record<string, unknown> = {status:'active'}) {
  const writes: unknown[] = [];
  const orderRef = {id:'order',get:async()=>({exists:true,id:'order',data:()=>order}),collection:()=>({doc:(id?:string)=>({id:id||'event'}),get:async()=>({docs:[]}),add:async()=>({})})};
  let reads=0;
  const tx = {get:jest.fn(async()=>{if(writes.length)throw new Error('Transaction read after write');return {exists:true,data:()=>++reads===1?order:bid};}),set:jest.fn((...args:unknown[])=>{writes.push(args);})};
  const firebase={db:{collection:()=>({doc:()=>orderRef}),batch:()=>({set:()=>{},commit:async()=>{}}),runTransaction:async(fn:(value:typeof tx)=>Promise<void>)=>fn(tx)},serverTimestamp:()=> 'now'};
  const service=new OrdersService(firebase as unknown as FirebaseService,{} as PricingService,{} as ServiceAreaService,{get:()=> 'https://example.com/track'} as unknown as ConfigService);
  return {service,writes,tx};
}
describe('merchant bid rejection',()=>{
  it('rejects an owned active bid and writes its event atomically',async()=>{
    const {service,tx}=fixture({source:{merchantId:'shop'},status:'bidding'});
    await expect(service.rejectBid(merchant,'order','bid')).resolves.toEqual({orderId:'order',bidId:'bid',status:'rejected'});
    expect(tx.set).toHaveBeenCalledTimes(2);
    expect(tx.set.mock.calls[0][1]).toMatchObject({status:'rejected',rejectedByMerchantId:'shop'});
  });
  it('denies another merchant without any writes',async()=>{
    const {service,writes}=fixture({source:{merchantId:'other'},status:'bidding'});
    await expect(service.rejectBid(merchant,'order','bid')).rejects.toBeInstanceOf(ForbiddenException);expect(writes).toEqual([]);
  });
  it('denies assigned orders and active checkout bids',async()=>{
    for(const order of [{source:{merchantId:'shop'},status:'bid_accepted'},{source:{merchantId:'shop'},status:'bidding',payment:{checkoutBidId:'bid',status:'checkout_pending'}}]){
      const {service,writes}=fixture(order);await expect(service.rejectBid(merchant,'order','bid')).rejects.toBeInstanceOf(ConflictException);expect(writes).toEqual([]);
    }
  });
  it('is idempotent for an already rejected bid',async()=>{
    const {service,writes}=fixture({source:{merchantId:'shop'},status:'bidding'},{status:'rejected'});
    await service.rejectBid(merchant,'order','bid');expect(writes).toEqual([]);
  });
});
describe('checkout session ownership',()=>{
  it('finalizes a verified owned checkout without reading after transaction writes',async()=>{
    const {service,tx}=fixture({source:{merchantId:'shop'},status:'bidding',payment:{checkoutSessionId:'session',checkoutBidId:'bid',totalOre:10000}},{status:'active',driver:{id:'driver'},offer:{amount:100}});
    Object.assign(service,{stripe:{checkout:{sessions:{retrieve:async()=>({payment_status:'paid',currency:'nok',amount_total:10000,metadata:{merchantId:'shop',orderId:'order',bidId:'bid'}})}}}});
    await expect(service.finalizeBid(merchant,'order','bid','session')).resolves.toMatchObject({orderId:'order'});
    expect(tx.set.mock.calls[0][1]).toMatchObject({status:'bid_accepted',paymentStatus:'paid'});
    expect(tx.set.mock.calls[1][1]).toMatchObject({status:'accepted'});
  });
  it('rejects a paid session for another merchant/order/bid before writing',async()=>{
    const {service,writes}=fixture({});
    Object.assign(service,{stripe:{checkout:{sessions:{retrieve:async()=>({payment_status:'paid',metadata:{merchantId:'other',orderId:'order',bidId:'bid'}})}}}});
    await expect(service.finalizeBid(merchant,'order','bid','session')).rejects.toBeInstanceOf(ForbiddenException);expect(writes).toEqual([]);
  });
  it('rejects a mismatched saved session even with matching metadata',async()=>{
    const {service,writes}=fixture({source:{merchantId:'shop'},status:'bidding',payment:{checkoutSessionId:'another',checkoutBidId:'bid',totalOre:10000}});
    Object.assign(service,{stripe:{checkout:{sessions:{retrieve:async()=>({payment_status:'paid',currency:'nok',amount_total:10000,metadata:{merchantId:'shop',orderId:'order',bidId:'bid'}})}}}});
    await expect(service.finalizeBid(merchant,'order','bid','session')).rejects.toBeInstanceOf(ConflictException);expect(writes).toEqual([]);
  });
});
