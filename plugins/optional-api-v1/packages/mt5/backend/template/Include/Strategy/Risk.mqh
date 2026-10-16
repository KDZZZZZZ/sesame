#ifndef STRATEGY_RISK_MQH
#define STRATEGY_RISK_MQH
// Agent-owned admission/cooldown policy; independent of platform hard limits.
// Blocking new exposure must keep exits and protective actions available.
class CStrategyRisk
  {
public:
   bool Configure() { return false; }
   void Refresh() {}
   bool AllowNewRisk() { return false; }
   void OnTransaction(const MqlTradeTransaction &tx,const MqlTradeRequest &request,const MqlTradeResult &result) {}
  };
#endif
