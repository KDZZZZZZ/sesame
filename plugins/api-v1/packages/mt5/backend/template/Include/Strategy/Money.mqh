#ifndef STRATEGY_MONEY_MQH
#define STRATEGY_MONEY_MQH
#include <Expert/ExpertMoney.mqh>
// Agent-owned sizing. Select a native implementation or write one explicitly.
// State budget basis, volume rounding, SL units and insufficient-budget behavior.
class CStrategyMoney : public CExpertMoney
  {
public:
   bool Configure() { return false; }
   virtual double CheckOpenLong(double price,double sl) { return 0.0; }
   virtual double CheckOpenShort(double price,double sl) { return 0.0; }
  };
#endif
