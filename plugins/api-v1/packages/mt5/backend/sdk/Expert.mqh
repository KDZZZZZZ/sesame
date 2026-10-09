#ifndef PRODUCT_EXPERT_MQH
#define PRODUCT_EXPERT_MQH
#include <Expert/Expert.mqh>
#include <Product/Trade.mqh>

class CProductExpert : public CExpert
  {
private:
   CProductTrade *m_product_trade;
public:
   CProductExpert() : m_product_trade(NULL) {}
   virtual bool InitTrade(ulong magic,CExpertTrade *trade=NULL)
     {
      if(trade!=NULL) { delete trade; return false; }
      m_product_trade=new CProductTrade;
      return CExpert::InitTrade(magic,m_product_trade);
     }
   bool ManagedRequest(MqlTradeRequest &request,MqlTradeResult &result)
     { return m_product_trade!=NULL && m_product_trade.OrderSend(request,result); }
   virtual void OnTick() { ProductRisk.Refresh(); CExpert::OnTick(); }
   virtual void OnTimer() { ProductRisk.Refresh(); CExpert::OnTimer(); }
   virtual void OnTrade() { ProductRisk.Refresh(); CExpert::OnTrade(); }
  };
#endif
