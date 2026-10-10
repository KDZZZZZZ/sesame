#ifndef PRODUCT_TRADE_MQH
#define PRODUCT_TRADE_MQH
#include <Expert/ExpertTrade.mqh>
#include <Product/Risk.mqh>

class CProductTrade : public CExpertTrade
  {
private:
   bool m_unresolved;
public:
   CProductTrade() : m_unresolved(false) {}
   virtual bool OrderSend(const MqlTradeRequest &request,MqlTradeResult &result)
     {
      string reason;
      bool allowed=ProductRisk.Check(request,reason);
      if(m_unresolved && reason=="entry_allowed") { allowed=false; reason="previous_request_unresolved"; }
      ProductEmit("risk","platform.risk",StringFormat("{\"allowed\":%s,\"reason\":%s,\"volume\":%.8f,\"sl\":%.8f}",allowed ? "true" : "false",ProductQuote(reason),request.volume,request.sl));
      if(!allowed) { ZeroMemory(result); result.retcode=TRADE_RETCODE_REJECT; result.comment=reason; return false; }
      SetAsyncMode(false);
      bool sent=CExpertTrade::OrderSend(request,result);
      // A timeout/ambiguous response must never lead to an automatic duplicate order.
      if(result.retcode==TRADE_RETCODE_TIMEOUT || result.retcode==TRADE_RETCODE_CONNECTION || result.retcode==TRADE_RETCODE_DONE_PARTIAL || result.retcode==0) m_unresolved=true;
      ProductEmit("request_result","platform.trade",StringFormat("{\"sent\":%s,\"request_id\":%u,\"retcode\":%u,\"order\":\"%I64u\",\"deal\":\"%I64u\"}",sent ? "true" : "false",result.request_id,result.retcode,result.order,result.deal));
      return sent;
     }
  };
#endif
