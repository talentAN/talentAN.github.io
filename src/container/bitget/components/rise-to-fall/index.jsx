import React from 'react';
import { Operation } from '../column';
import { useRiseToFallLine } from '../../hooks/rise-to-fall';
import { Table, Typography, Tag, Spin, Card } from 'antd';
import moment from 'moment';

const { Text, Title } = Typography;

const RiseToFallTable = ({ futureSymbols }) => {
  const { symbols, checkedSymbolCount, volumeSpikeData } = useRiseToFallLine({
    futureSymbols,
  });

  // 格式化成交量为 K、M 单位
  const formatVolume = volume => {
    const num = parseFloat(volume);
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(2) + 'K';
    }
    return num.toString();
  };

  // 获取模式标签信息（显示所有命中的支撑/阻力位的识别方法）
  const getModeTag = record => {
    const { entrySignal } = record;
    if (!entrySignal) return '-';

    const tags = [];

    // 支撑位识别方法（显示所有命中的支撑位）
    if (entrySignal.bullish?.shouldEntry && entrySignal.bullish?.triggeredLevels) {
      const triggeredLevels = entrySignal.bullish.triggeredLevels;
      triggeredLevels.forEach((level, idx) => {
        const methods = level.methods || [];
        methods.forEach(method => {
          const methodLabel =
            method === 'swing' ? '摆动点' : method === 'consolidation' ? '密集区' : method;
          tags.push(
            <Tag key={`support-${idx}-${method}`} color="green">
              {methodLabel}-支撑位
            </Tag>
          );
        });
      });
    }

    // 阻力位识别方法（显示所有命中的阻力位）
    if (entrySignal.bearish?.shouldEntry && entrySignal.bearish?.triggeredLevels) {
      const triggeredLevels = entrySignal.bearish.triggeredLevels;
      triggeredLevels.forEach((level, idx) => {
        const methods = level.methods || [];
        methods.forEach(method => {
          const methodLabel =
            method === 'swing' ? '摆动点' : method === 'consolidation' ? '密集区' : method;
          tags.push(
            <Tag key={`resistance-${idx}-${method}`} color="red">
              {methodLabel}-阻力位
            </Tag>
          );
        });
      });
    }

    return tags.length > 0 ? tags : '-';
  };

  // 获取阻力/支撑价格（显示所有触发的，如果价格不同）
  const getLevelPrice = record => {
    const { entrySignal } = record;
    if (!entrySignal) return '-';

    const prices = [];

    // 支撑位价格（显示所有触发的，但去重相似价格）
    if (entrySignal.bullish?.shouldEntry && entrySignal.bullish?.triggeredLevels) {
      const triggeredLevels = entrySignal.bullish.triggeredLevels;
      // 按价格排序并去重（容差1.5%内认为是相同价格）
      const uniquePrices = [];
      triggeredLevels.forEach(level => {
        const isDuplicate = uniquePrices.some(
          p => Math.abs(p - level.price) <= level.price * 0.015
        );
        if (!isDuplicate) {
          uniquePrices.push(level.price);
        }
      });

      const supportPricesStr = uniquePrices.map(p => parseFloat(p).toFixed(4)).join(', ');
      prices.push(
        <div key="support">
          <Text type="success">支撑: {supportPricesStr}</Text>
        </div>
      );
    }

    // 阻力位价格（显示所有触发的，但去重相似价格）
    if (entrySignal.bearish?.shouldEntry && entrySignal.bearish?.triggeredLevels) {
      const triggeredLevels = entrySignal.bearish.triggeredLevels;
      // 按价格排序并去重（容差1.5%内认为是相同价格）
      const uniquePrices = [];
      triggeredLevels.forEach(level => {
        const isDuplicate = uniquePrices.some(
          p => Math.abs(p - level.price) <= level.price * 0.015
        );
        if (!isDuplicate) {
          uniquePrices.push(level.price);
        }
      });

      const resistancePricesStr = uniquePrices.map(p => parseFloat(p).toFixed(4)).join(', ');
      prices.push(
        <div key="resistance">
          <Text type="danger">阻力: {resistancePricesStr}</Text>
        </div>
      );
    }

    return prices.length > 0 ? prices : '-';
  };

  // 获取确认K线
  const getConfirmKline = record => {
    const { entrySignal } = record;
    if (!entrySignal) return '-';

    const klines = [];

    if (entrySignal.bullish?.shouldEntry && entrySignal.bullish?.signal) {
      klines.push(
        <Tag key="bullish-kline" color="blue">
          看涨: {entrySignal.bullish.signal.pattern}
        </Tag>
      );
    }

    if (entrySignal.bearish?.shouldEntry && entrySignal.bearish?.signal) {
      klines.push(
        <Tag key="bearish-kline" color="orange">
          看跌: {entrySignal.bearish.signal.pattern}
        </Tag>
      );
    }

    return klines.length > 0 ? klines : '-';
  };

  const columns = [
    {
      title: '交易对',
      dataIndex: 'symbol',
      key: 'symbol',
      render: text => <Text strong>{text}</Text>,
    },
    {
      title: '当前价格',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      render: text => <Text strong>{text}</Text>,
    },
    {
      title: '模式',
      key: 'mode',
      render: (_, record) => getModeTag(record),
    },
    {
      title: '阻力/支撑价格',
      key: 'levelPrice',
      render: (_, record) => getLevelPrice(record),
    },
    {
      title: '确认K线',
      key: 'confirmKline',
      render: (_, record) => getConfirmKline(record),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => <Operation record={record} />,
    },
  ];

  return (
    <>
      <div>{`共${futureSymbols?.length}，已查看${checkedSymbolCount}，已筛选${symbols.length}`}</div>
      <Table
        columns={columns}
        dataSource={symbols.map((item, index) => ({
          ...item,
          key: item.symbol || index,
        }))}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: total => `共 ${total} 个交易对`,
        }}
        scroll={{ x: 1200 }}
      />

      <Card style={{ marginTop: 16 }}>
        <Title level={4}>成交量爆炸币对 (倒数第3/4天成交量 {'>'}过去20天平均的2倍)</Title>
        <Table
          columns={[
            {
              title: '币对',
              dataIndex: 'symbol',
              key: 'symbol',
              width: '10%',
            },
            {
              title: '最新价格',
              dataIndex: 'currentPrice',
              key: 'currentPrice',
              width: '10%',
              render: text => <Text strong>{text}</Text>,
            },
            {
              title: '昨日成交量',
              dataIndex: 'yesterdayVolume',
              key: 'yesterdayVolume',
              width: '12%',
              render: volume => formatVolume(volume),
            },
            {
              title: '爆炸成交量',
              dataIndex: 'spikeVolume',
              key: 'spikeVolume',
              width: '12%',
              render: volume => formatVolume(volume),
            },
            {
              title: '过去20天平均',
              dataIndex: 'avgVolume',
              key: 'avgVolume',
              width: '12%',
              render: volume => formatVolume(volume),
            },
            {
              title: '倍数',
              dataIndex: 'ratio',
              key: 'ratio',
              width: '10%',
              render: ratio => <Tag color="green">{ratio}x</Tag>,
            },
            {
              title: '操作',
              key: 'action',
              width: '18%',
              render: (_, record) => <Operation record={record} />,
            },
          ]}
          dataSource={volumeSpikeData.map((item, index) => ({
            ...item,
            key: index,
          }))}
          pagination={{ pageSize: 20 }}
          locale={{
            emptyText:
              checkedSymbolCount < futureSymbols?.length ? '检查中...' : '暂无符合条件的币对',
          }}
        />
      </Card>
    </>
  );
};

export default RiseToFallTable;
