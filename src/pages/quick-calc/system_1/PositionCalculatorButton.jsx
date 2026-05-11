import React, { useState, useEffect, useRef } from 'react';
import {
  Form,
  InputNumber,
  Button,
  Typography,
  Space,
  Divider,
  Row,
  Col,
  Segmented,
  Progress,
  Alert,
  message,
} from 'antd';
import { CopyOutlined, CalculatorOutlined, CloseOutlined, DragOutlined } from '@ant-design/icons';

const { Text } = Typography;

// 浮动弹窗默认位置 (可按需调整)
const POPUP_TOP = 150;
const POPUP_RIGHT = 24;
const POPUP_WIDTH = 400;
const POPUP_Z = 900;

/**
 * 仓位计算器按钮组件
 * 点击按钮弹出可拖拽的非模态浮窗, 不阻塞页面其他操作
 *
 * Props:
 *   size  - 触发按钮尺寸 ('small' | 'middle' | 'large'), 默认 'middle'
 *   label - 触发按钮文案, 默认 '仓位计算器'
 */
const PositionCalculatorButton = ({ size = 'middle', label = '仓位计算器' }) => {
  const [direction, setDirection] = useState('long');
  const [result, setResult] = useState(null);
  const [rrResult, setRrResult] = useState(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [form] = Form.useForm();

  // 拖拽: pos === null 时使用默认 right 锚定 (SSR 友好), 拖过后切换为 left/top 绝对定位
  const [pos, setPos] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef(null);

  const handleDragStart = e => {
    const initX =
      pos?.x ?? (typeof window !== 'undefined' ? window.innerWidth - POPUP_WIDTH - POPUP_RIGHT : 0);
    const initY = pos?.y ?? POPUP_TOP;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: initX,
      origY: initY,
    };
    setIsDragging(true);
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return undefined;
    const onMove = e => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      let nx = dragRef.current.origX + dx;
      let ny = dragRef.current.origY + dy;
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 60;
      nx = Math.max(-POPUP_WIDTH + 60, Math.min(nx, maxX));
      ny = Math.max(0, Math.min(ny, maxY));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      dragRef.current = null;
      setIsDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  const resetPosition = () => setPos(null);

  const calculatePosition = values => {
    const { capital, riskPct, entry, stopLoss, target, leverage } = values;

    if (!capital || !riskPct || !entry || !stopLoss || !leverage) {
      message.error('请填写所有必填项');
      return;
    }

    const isLongValid = direction === 'long' && stopLoss < entry;
    const isShortValid = direction === 'short' && stopLoss > entry;

    if (!isLongValid && !isShortValid) {
      const directionText = direction === 'long' ? '做多' : '做空';
      const expectedText = direction === 'long' ? '止损价应该小于入场价' : '止损价应该大于入场价';
      message.error(`${directionText}方向与止损价不匹配，${expectedText}`);
      return;
    }

    const stopDist = Math.abs(entry - stopLoss) / entry;
    const stopDistPct = stopDist * 100;
    const maxLoss = capital * (riskPct / 100);
    const notional = maxLoss / stopDist;
    const margin = notional / leverage;
    const qty = notional / entry;
    const liqDist = (1 / leverage) * 100;
    const verifyLoss = notional * stopDist;
    const verifyPct = (verifyLoss / capital) * 100;

    const alerts = [];

    if (margin > capital) {
      alerts.push({
        type: 'error',
        message: `保证金 ${margin.toFixed(0)}U 超过总资金 — 请降低杠杆或增大止损距离`,
      });
    }

    if (stopDistPct >= liqDist) {
      alerts.push({
        type: 'error',
        message: `止损幅度 ${stopDistPct.toFixed(1)}% ≥ 强平距离 ${liqDist.toFixed(1)}% — 会被爆仓！请降低杠杆`,
      });
    }

    if (riskPct > 2) {
      alerts.push({
        type: 'warning',
        message: `单笔风险 ${riskPct}% 超过建议上限 2%`,
      });
    }

    setResult({
      stopDistPct,
      maxLoss,
      notional,
      margin,
      qty,
      liqDist,
      verifyLoss,
      verifyPct,
      alerts,
      marginPct: (margin / capital) * 100,
    });

    if (target && target > 0) {
      const isValidTarget =
        (direction === 'long' && target > entry) || (direction === 'short' && target < entry);

      if (isValidTarget) {
        const profitDist = Math.abs(target - entry) / entry;
        const rr = profitDist / stopDist;
        const profitU = notional * profitDist;
        const profitR = profitU / maxLoss;

        const rrAlerts = [];
        if (rr < 2) {
          rrAlerts.push({
            type: 'error',
            message: `盈亏比 ${rr.toFixed(2)} < 2 — 系统要求 ≥ 2`,
          });
        } else {
          rrAlerts.push({
            type: 'success',
            message: `盈亏比 ${rr.toFixed(2)} ≥ 2 ✓`,
          });
        }

        setRrResult({
          rr,
          profitU,
          profitR,
          rrAlerts,
          barTotal: 1 + rr,
        });
      } else {
        setRrResult(null);
      }
    } else {
      setRrResult(null);
    }
  };

  const handleCopyOrderInfo = () => {
    if (!result) {
      message.warning('请先计算仓位');
      return;
    }

    const entry = form.getFieldValue('entry');
    const stopLoss = form.getFieldValue('stopLoss');
    const target = form.getFieldValue('target');
    const rrText = rrResult ? `，盈亏比：1:${rrResult.rr.toFixed(2)}` : '';

    const copyText = `计划开仓价：${entry}，止损：${stopLoss}，止盈：${target || '待定'}${rrText}`;

    navigator.clipboard
      .writeText(copyText)
      .then(() => message.success('已复制'))
      .catch(() => message.error('复制失败'));
  };

  const handleCopySimulate = () => {
    if (!result) {
      message.warning('请先计算仓位');
      return;
    }
    const entry = form.getFieldValue('entry');
    const stopLoss = form.getFieldValue('stopLoss');
    const leverage = form.getFieldValue('leverage');
    const copyText = `simulate:${entry},${stopLoss},${leverage}`;
    navigator.clipboard
      .writeText(copyText)
      .then(() => message.success('已复制模拟数据'))
      .catch(() => message.error('复制失败'));
  };

  // 计算表单 (弹窗上半部分)
  const calculatorForm = (
    <>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
          方向
        </label>
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { label: '做多 Long', value: 'long' },
            { label: '做空 Short', value: 'short' },
          ]}
          block
          className={`pcb-direction-toggle direction-${direction}`}
          style={{ fontSize: 12 }}
        />
        <style>{`
          .pcb-direction-toggle.direction-long .ant-segmented-item-selected {
            background-color: #52c41a !important;
            color: white !important;
          }
          .pcb-direction-toggle.direction-short .ant-segmented-item-selected {
            background-color: #ff4d4f !important;
            color: white !important;
          }
        `}</style>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={calculatePosition}
        initialValues={{ capital: 500, riskPct: 2, leverage: 5 }}
      >
        <Row gutter={8}>
          <Col span={12}>
            <Form.Item
              label="总资金"
              name="capital"
              rules={[{ required: true, message: '必填' }]}
              style={{ marginBottom: 8 }}
            >
              <InputNumber
                style={{ width: '100%', fontSize: 12 }}
                min={0}
                step={1}
                placeholder="USDT"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="风险 %"
              name="riskPct"
              rules={[{ required: true, message: '必填' }]}
              style={{ marginBottom: 8 }}
            >
              <InputNumber
                style={{ width: '100%', fontSize: 12 }}
                min={0}
                max={5}
                step={0.1}
                placeholder="LE ≤ 2%"
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={8}>
          <Col span={12}>
            <Form.Item
              label="入场价"
              name="entry"
              rules={[{ required: true, message: '必填' }]}
              style={{ marginBottom: 8 }}
            >
              <InputNumber
                style={{ width: '100%', fontSize: 12 }}
                min={0}
                step="any"
                placeholder="USDT"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="止损价"
              name="stopLoss"
              rules={[{ required: true, message: '必填' }]}
              style={{ marginBottom: 8 }}
            >
              <InputNumber
                style={{ width: '100%', fontSize: 12 }}
                min={0}
                step="any"
                placeholder="USDT"
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={8}>
          <Col span={12}>
            <Form.Item label="目标价（可选）" name="target" style={{ marginBottom: 8 }}>
              <InputNumber
                style={{ width: '100%', fontSize: 12 }}
                min={0}
                step="any"
                placeholder="USDT"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="杠杆"
              name="leverage"
              rules={[{ required: true, message: '必填' }]}
              style={{ marginBottom: 8 }}
            >
              <InputNumber style={{ width: '100%', fontSize: 12 }} min={1} max={125} step={1} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item style={{ marginBottom: 0 }}>
          <Space style={{ width: '100%' }} size={8}>
            <Button type="primary" htmlType="submit" style={{ fontSize: 14, flex: 8, height: 36 }}>
              计算仓位
            </Button>
            <Button
              icon={<CopyOutlined />}
              onClick={handleCopyOrderInfo}
              style={{ fontSize: 12, flex: 1, height: 36 }}
              title="复制: 开仓价、止损、止盈、盈亏比"
            />
            <Button
              onClick={handleCopySimulate}
              style={{ fontSize: 12, flex: 1, height: 36 }}
              title="复制模拟数据: 入场价、止损价、杠杆"
            >
              模拟
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </>
  );

  // 计算结果 (弹窗下半部分)
  const calculatorResult = result ? (
    <div style={{ background: '#f0f9ff', padding: 12, borderRadius: 6 }}>
      <Space direction="vertical" style={{ width: '100%' }} size={0}>
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 12 }}>
            止损幅度
          </Text>
          <div style={{ fontSize: 16, fontWeight: 'bold', color: '#1890ff', marginTop: 2 }}>
            {result.stopDistPct.toFixed(2)}%
          </div>
        </div>

        <Divider style={{ margin: '6px 0' }} />

        <Row gutter={12} style={{ marginBottom: 6 }}>
          <Col span={12}>
            <Text strong style={{ fontSize: 12 }}>
              最大亏损
            </Text>
            <div style={{ fontSize: 14, color: '#ff4d4f', marginTop: 2 }}>
              {result.maxLoss.toFixed(2)} U
            </div>
          </Col>
          <Col span={12}>
            <Text strong style={{ fontSize: 12 }}>
              名义仓位
            </Text>
            <div style={{ fontSize: 14, color: '#1890ff', marginTop: 2 }}>
              {result.notional.toFixed(2)} U
            </div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              ≈ {result.qty.toFixed(4)}
            </Text>
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 6 }}>
          <Col span={12}>
            <Text strong style={{ fontSize: 12 }}>
              所需保证金
            </Text>
            <div style={{ fontSize: 14, color: '#52c41a', marginTop: 2 }}>
              {result.margin.toFixed(2)} U
            </div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {result.marginPct.toFixed(1)}%
            </Text>
          </Col>
          <Col span={12}>
            <Text strong style={{ fontSize: 12 }}>
              强平距离
            </Text>
            <div style={{ fontSize: 14, marginTop: 2 }}>{result.liqDist.toFixed(1)}%</div>
          </Col>
        </Row>

        <Divider style={{ margin: '6px 0' }} />

        <div style={{ marginBottom: 6 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            验算：止损时亏损 {result.verifyLoss.toFixed(2)} U
            {Math.abs(result.verifyLoss - result.maxLoss) < 0.01 && (
              <Text type="success" style={{ marginLeft: 4, fontSize: 11 }}>
                ✓
              </Text>
            )}
          </Text>
        </div>

        {result.alerts.map((alert, idx) => (
          <Alert
            key={idx}
            type={alert.type}
            message={alert.message}
            showIcon
            style={{ marginTop: 6, fontSize: 12, padding: '6px 12px' }}
          />
        ))}

        {rrResult && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ marginBottom: 6 }}>
              <Text strong style={{ fontSize: 12 }}>
                盈亏比分析
              </Text>
            </div>
            <Row gutter={12} style={{ marginBottom: 6 }}>
              <Col span={8}>
                <Text strong style={{ fontSize: 11 }}>
                  R:R
                </Text>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 'bold',
                    color: rrResult.rr >= 2 ? '#52c41a' : '#ff4d4f',
                    marginTop: 2,
                  }}
                >
                  1 : {rrResult.rr.toFixed(2)}
                </div>
              </Col>
              <Col span={8}>
                <Text strong style={{ fontSize: 11 }}>
                  潜在盈利
                </Text>
                <div style={{ fontSize: 14, color: '#52c41a', marginTop: 2 }}>
                  +{rrResult.profitU.toFixed(2)} U
                </div>
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {rrResult.profitR.toFixed(1)}R
                </Text>
              </Col>
              <Col span={8}>
                <Text strong style={{ fontSize: 11 }}>
                  风险/收益
                </Text>
                <div style={{ fontSize: 10, marginTop: 4 }}>
                  <Progress
                    type="line"
                    percent={Math.round((1 / rrResult.barTotal) * 100)}
                    strokeColor="#ff4d4f"
                    showInfo={false}
                  />
                  <Progress
                    type="line"
                    percent={Math.round((rrResult.rr / rrResult.barTotal) * 100)}
                    strokeColor="#52c41a"
                    showInfo={false}
                    style={{ marginTop: 2 }}
                  />
                </div>
              </Col>
            </Row>
            {rrResult.rrAlerts.map((alert, idx) => (
              <Alert
                key={idx}
                type={alert.type}
                message={alert.message}
                showIcon
                style={{ marginBottom: 6, fontSize: 12, padding: '6px 12px' }}
              />
            ))}
          </>
        )}
      </Space>
    </div>
  ) : (
    <div
      style={{
        background: '#f5f5f5',
        padding: '24px 12px',
        borderRadius: 6,
        textAlign: 'center',
      }}
    >
      <Text type="secondary">计算结果将在此显示</Text>
    </div>
  );

  return (
    <>
      <Button
        type={popupOpen ? 'primary' : 'default'}
        icon={<CalculatorOutlined />}
        size={size}
        onClick={() => setPopupOpen(v => !v)}
      >
        {label}
      </Button>

      {/* 浮动弹窗 - 无蒙层, 可拖拽, 上下结构 (用 display 切换以保留表单状态) */}
      <div
        style={{
          display: popupOpen ? 'block' : 'none',
          position: 'fixed',
          top: pos ? pos.y : POPUP_TOP,
          left: pos ? pos.x : 'auto',
          right: pos ? 'auto' : POPUP_RIGHT,
          width: POPUP_WIDTH,
          maxHeight: `calc(100vh - ${(pos ? pos.y : POPUP_TOP) + 24}px)`,
          overflowY: 'auto',
          zIndex: POPUP_Z,
          background: '#fff',
          border: '1px solid #d9d9d9',
          borderRadius: 8,
          boxShadow: isDragging ? '0 12px 32px rgba(0,0,0,0.22)' : '0 8px 24px rgba(0,0,0,0.15)',
          userSelect: isDragging ? 'none' : 'auto',
          transition: isDragging ? 'none' : 'box-shadow 0.15s',
        }}
      >
        {/* 弹窗头部 - 拖拽手柄 */}
        <div
          onMouseDown={handleDragStart}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            background: '#fafafa',
            zIndex: 1,
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
        >
          <Text strong style={{ fontSize: 14 }}>
            <DragOutlined style={{ marginRight: 6, color: '#999' }} />
            <CalculatorOutlined style={{ marginRight: 6 }} />
            仓位计算器
          </Text>
          <Space size={4} onMouseDown={e => e.stopPropagation()}>
            {pos && (
              <Button
                type="text"
                size="small"
                onClick={resetPosition}
                style={{ fontSize: 11, color: '#999' }}
                title="重置到默认位置"
              >
                复位
              </Button>
            )}
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setPopupOpen(false)}
            />
          </Space>
        </div>

        {/* 上: 表单 */}
        <div style={{ padding: '12px 14px 0' }}>{calculatorForm}</div>

        {/* 下: 结果 */}
        <div style={{ padding: '12px 14px 14px' }}>{calculatorResult}</div>
      </div>
    </>
  );
};

export default PositionCalculatorButton;
