#ifndef STRATEGY_EXPERT_MQH
#define STRATEGY_EXPERT_MQH
#include <Product/Expert.mqh>
#include <Strategy/Risk.mqh>
#include <Strategy/Position.mqh>
input ulong InpMagic=20260930;
// Agent-owned native dispatch extension. Preserve CProductExpert inheritance,
// the wrapped trade object and admission checks when overriding native hooks.
class CStrategyExpert : public CProductExpert
  {
protected:
   CStrategyRisk m_strategy_risk;
   CStrategyPosition m_strategy_position;
   virtual bool CheckOpen() { return m_strategy_risk.AllowNewRisk() && CProductExpert::CheckOpen(); }
   virtual bool CheckReverse() { return m_strategy_risk.AllowNewRisk() && CProductExpert::CheckReverse(); }
   virtual bool CheckClose()
     {
      if(m_strategy_position.Manage(GetPointer(m_position),m_trade)) return true;
      return CProductExpert::CheckClose();
     }
public:
   bool Configure() { return m_strategy_risk.Configure() && m_strategy_position.Configure(); }
   void Observe() { m_strategy_risk.Refresh(); m_strategy_position.Refresh(); }
   void OnTransaction(const MqlTradeTransaction &tx,const MqlTradeRequest &request,const MqlTradeResult &result)
     { m_strategy_risk.OnTransaction(tx,request,result); m_strategy_position.OnTransaction(tx,request,result); }
  };
#endif
