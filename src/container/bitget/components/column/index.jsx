import React from 'react';
import { 
    Button, 
  } from 'antd';

export const Operation = ({record})=> <div>
    <div style={{display:'flex', alignItems:'center'}}>
    <Button 
      type="link" 
      onClick={() => {
        window.open(`https://www.sjk2oahoo1.com/zh-CN/futures/usdt/${record.symbol}`, '_blank');
      }}
    >
      sjk-合约
    </Button>
    <Button 
      type="link" 
      onClick={() => {
        window.open(`https://www.bitget.cloud/zh-CN/futures/usdt/${record.symbol}`, '_blank');
      }}
    >
      cn-合约
    </Button>
    <Button 
      type="link" 
      onClick={() => {
        window.open(`https://www.bitget.com/zh-CN/futures/usdt/${record.symbol}`, '_blank');
      }}
    >
      com-合约
    </Button>
    </div>
<div style={{display:'flex', alignItems:'center'}}>
<Button 
  type="link" 
  onClick={() => {
    window.open(`https://www.sjk2oahoo1.com/zh-CN/spot/${record.symbol}`, '_blank');
  }}
>
  sjk-现货
</Button>
<Button 
  type="link" 
  onClick={() => {
    window.open(`https://www.bitget.cloud/zh-CN/spot/${record.symbol}`, '_blank');
  }}
>
  cn-现货
</Button>
<Button 
  type="link" 
  onClick={() => {
    window.open(`https://www.bitget.com/zh-CN/spot/${record.symbol}`, '_blank');
  }}
>
  com-现货
</Button>
</div>
  </div>
