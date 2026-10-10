#ifndef PRODUCT_RISK_MQH
#define PRODUCT_RISK_MQH
#include <Product/Telemetry.mqh>

// Platform inputs are frozen by the Tester/deployment controller.
input double Product_MaxRiskPct=0.5;
input double Product_MaxDailyLossPct=2.0;
input int Product_MaxPositions=1;
input double Product_MaxLots=1.0;

class CProductRisk
  {
private:
   int m_day;
   double m_day_equity;
   bool m_daily_blocked;
public:
   CProductRisk() : m_day(-1),m_day_equity(0),m_daily_blocked(false) {}
   void Refresh()
     {
      MqlDateTime t; TimeToStruct(TimeCurrent(),t);
      int day=t.year*1000+t.day_of_year;
      string key=StringFormat("MT5Agent.%I64d.%s.%d",AccountInfoInteger(ACCOUNT_LOGIN),StringSubstr(AccountInfoString(ACCOUNT_SERVER),0,16),day);
      if(day!=m_day)
        {
         m_day=day; m_day_equity=AccountInfoDouble(ACCOUNT_EQUITY); m_daily_blocked=false;
         if(!MQLInfoInteger(MQL_TESTER))
           {
            if(GlobalVariableCheck(key)) m_day_equity=GlobalVariableGet(key); else GlobalVariableSet(key,m_day_equity);
            m_daily_blocked=GlobalVariableCheck(key+".blocked");
           }
        }
      if(m_day_equity<=0 || AccountInfoDouble(ACCOUNT_EQUITY)<=m_day_equity*(1.0-Product_MaxDailyLossPct/100.0)) m_daily_blocked=true;
      if(m_daily_blocked && !MQLInfoInteger(MQL_TESTER)) { GlobalVariableSet(key+".blocked",1); GlobalVariablesFlush(); }
     }
   bool Check(const MqlTradeRequest &r,string &reason)
     {
      Refresh();
      if(!ProductExecutionAllowed()) { reason="managed_execution_not_authorized"; return false; }
      if(r.action==TRADE_ACTION_REMOVE) { reason="cancel_order"; return true; }
      if(r.action==TRADE_ACTION_DEAL && r.position>0 && PositionSelectByTicket(r.position))
        {
         bool opposite=(PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY && r.type==ORDER_TYPE_SELL) || (PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_SELL && r.type==ORDER_TYPE_BUY);
         if(PositionGetString(POSITION_SYMBOL)==r.symbol && opposite && r.volume>0 && r.volume<=PositionGetDouble(POSITION_VOLUME))
           { reason="reduce_position"; return true; }
        }
      if(r.action==TRADE_ACTION_SLTP && PositionSelectByTicket(r.position))
        {
         double old_sl=PositionGetDouble(POSITION_SL);
         bool buy=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
         if(r.sl>0 && (old_sl==0 || (buy ? r.sl>=old_sl : r.sl<=old_sl))) { reason="protect_position"; return true; }
         reason="protection_cannot_be_removed_or_widened"; return false;
        }
      // Fail closed for close-by and pending modifications until their native cases are verified.
      if(r.action!=TRADE_ACTION_DEAL && r.action!=TRADE_ACTION_PENDING) { reason="unsupported_trade_action"; return false; }
      if(Product_MaxRiskPct<=0 || Product_MaxDailyLossPct<=0 || Product_MaxPositions<=0 || Product_MaxLots<=0) { reason="invalid_platform_limits"; return false; }
      if(m_daily_blocked) { reason="daily_loss_limit"; return false; }
      if(PositionsTotal()+OrdersTotal()>=Product_MaxPositions) { reason="position_or_pending_limit"; return false; }
      double reserved=0;
      for(int i=0;i<PositionsTotal();i++) if(PositionGetTicket(i)>0) reserved+=PositionGetDouble(POSITION_VOLUME);
      for(int i=0;i<OrdersTotal();i++) if(OrderGetTicket(i)>0) reserved+=OrderGetDouble(ORDER_VOLUME_CURRENT);
      if(r.volume<=0 || reserved+r.volume>Product_MaxLots+1e-9) { reason="account_lots_limit"; return false; }
      bool buy=r.type==ORDER_TYPE_BUY || r.type==ORDER_TYPE_BUY_LIMIT || r.type==ORDER_TYPE_BUY_STOP || r.type==ORDER_TYPE_BUY_STOP_LIMIT;
      double price=r.price;
      if(r.action==TRADE_ACTION_DEAL) { MqlTick tick; if(!SymbolInfoTick(r.symbol,tick)) { reason="no_quote"; return false; } price=buy ? tick.ask : tick.bid; }
      if(r.stoplimit>0) price=buy ? MathMax(price,r.stoplimit) : MathMin(price,r.stoplimit);
      if(price<=0 || r.sl<=0 || (buy ? r.sl>=price : r.sl<=price)) { reason="entry_requires_valid_stop"; return false; }
      double loss;
      if(!OrderCalcProfit(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL,r.symbol,r.volume,price,r.sl,loss)) { reason="risk_calculation_failed"; return false; }
      if(-loss>AccountInfoDouble(ACCOUNT_EQUITY)*Product_MaxRiskPct/100.0) { reason="per_request_risk_limit"; return false; }
      reason="entry_allowed"; return true;
     }
  };
CProductRisk ProductRisk;
#endif
