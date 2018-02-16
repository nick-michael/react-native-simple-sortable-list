import React, {Component} from 'react';
import PropTypes from 'prop-types';
import { ScrollView, View, StyleSheet, Platform, RefreshControl, ViewPropTypes } from 'react-native';
import { shallowEqual } from './utils';
import Row from './Row';

const AUTOSCROLL_INTERVAL = 100;
const ZINDEX = Platform.OS === 'ios' ? 'zIndex' : 'elevation';

function uniqueRowKey(key) {
  return `${key}${uniqueRowKey.id}`
}

uniqueRowKey.id = 0

export default class SortableList extends Component {
  static propTypes = {
    data: PropTypes.oneOfType([PropTypes.array, PropTypes.object]).isRequired, 
    order: PropTypes.arrayOf(PropTypes.any),
    style: ViewPropTypes.style,
    contentContainerStyle: ViewPropTypes.style,
    sortingEnabled: PropTypes.bool,
    scrollEnabled: PropTypes.bool,
    refreshControl: PropTypes.element,
    autoscrollAreaSize: PropTypes.number,
    rowActivationTime: PropTypes.number,
    manuallyActivateRows: PropTypes.bool,

    renderRow: PropTypes.func.isRequired,

    onChangeOrder: PropTypes.func,
    onActivateRow: PropTypes.func,
    onReleaseRow: PropTypes.func,
  };

  static defaultProps = {
    sortingEnabled: true,
    scrollEnabled: true,
    autoscrollAreaSize: 60,
    manuallyActivateRows: false
  }

  /**
   * Stores refs to rows’ components by keys.
   */
  _rows = {};

  /**
   * Stores promises of rows’ layouts.
   */
  _rowsLayouts = {};
  _resolveRowLayout = {};

  _contentOffset = {x: 0, y: 0};

  _initialRowIndex;
  _hoverIndex;

  state = {
    animated: false,
    order: this.props.order || Object.keys(this.props.data),
    rowsLayouts: null,
    containerLayout: null,
    data: this.props.data,
    activeRowKey: null,
    releasedRowKey: null,
    sortingEnabled: this.props.sortingEnabled,
    scrollEnabled: this.props.scrollEnabled
  };

  componentWillMount() {
    this.state.order.forEach((key) => {
      this._rowsLayouts[key] = new Promise((resolve) => {
        this._resolveRowLayout[key] = resolve;
      });
    });
  }

  componentDidMount() {
    this._onUpdateLayouts();
  }

  componentWillReceiveProps(nextProps) {
    const {data, order} = this.state;
    let {data: nextData, order: nextOrder} = nextProps;

    if (data && nextData && !shallowEqual(data, nextData)) {
      nextOrder = nextOrder || Object.keys(nextData)
      uniqueRowKey.id++;
      this._rowsLayouts = {};
      nextOrder.forEach((key) => {
        this._rowsLayouts[key] = new Promise((resolve) => {
          this._resolveRowLayout[key] = resolve;
        });
      });
      this.setState({
        animated: false,
        data: nextData,
        containerLayout: null,
        rowsLayouts: null,
        order: nextOrder
      });

    } else if (order && nextOrder && !shallowEqual(order, nextOrder)) {
      this.setState({order: nextOrder});
    }
  }

  componentDidUpdate(prevProps, prevState) {
    const {data} = this.state;
    const {data: prevData} = prevState;

    if (data && prevData && !shallowEqual(data, prevData)) {
      this._onUpdateLayouts();
    }
  }

  scrollBy({dx = 0, dy = 0, animated = false}) {
    this._contentOffset.y += dy;
    this._scroll(animated);
  }

  scrollTo({x = 0, y = 0, animated = false}) {
    this._contentOffset.y = y;
    this._scroll(animated);
  }

  scrollToRowKey({key, animated = false}) {
    const {order, containerLayout, rowsLayouts} = this.state;

    let keyX = 0;
    let keyY = 0;

    for (const rowKey of order) {
      if (rowKey === key) {
          break;
      }

      keyX += rowsLayouts[rowKey].width;
      keyY += rowsLayouts[rowKey].height;
    }

    // Scroll if the row is not visible.
    if (keyY < this._contentOffset.y || keyY > this._contentOffset.y + containerLayout.height) {
      this._contentOffset.y = keyY;
      this._scroll(animated);
    }
  }

  render() {
    const {contentContainerStyle, style, rowContainerStyle} = this.props;
    const {animated, contentHeight, contentWidth, scrollEnabled} = this.state;
    const containerStyle = StyleSheet.flatten([style, {opacity: Number(animated)}])
    const innerContainerStyle = [
      styles.rowsContainer,
      {height: contentHeight},
    ];
    let {refreshControl} = this.props;

    if (refreshControl && refreshControl.type === RefreshControl) {
      refreshControl = React.cloneElement(this.props.refreshControl, {
        enabled: scrollEnabled, // fix for Android
      });
    }

    return (
      <View style={containerStyle} ref={this._onRefContainer}>
        <ScrollView
          refreshControl={refreshControl}
          ref={this._onRefScrollView}
          contentContainerStyle={contentContainerStyle}
          scrollEventThrottle={2}
          scrollEnabled={scrollEnabled}
          onScroll={this._onScroll}>
          <View style={innerContainerStyle}>
            {this._renderRows()}
          </View>
        </ScrollView>
      </View>
    );
  }

  _renderRows() {
    const {rowActivationTime, sortingEnabled, renderRow} = this.props;
    const {animated, order, data, activeRowKey, releasedRowKey, rowsLayouts} = this.state;


    let nextX = 0;
    let nextY = 0;

    return order.map((key, index) => {
      const style = {[ZINDEX]: 0};
      const location = {x: 0, y: 0};

      if (rowsLayouts && typeof(rowsLayouts[key]) !== 'undefined') {
        location.y = nextY;
        nextY += rowsLayouts[key].height;
      }

      const active = activeRowKey === key;
      const released = releasedRowKey === key;

      if (active || released) {
        style[ZINDEX] = 100;
      }

      return (
        <Row
          key={uniqueRowKey(key)}
          ref={this._onRefRow.bind(this, key)}
          activationTime={rowActivationTime}
          animated={animated && !active}
          disabled={!sortingEnabled}
          style={style}
          location={location}
          onLayout={!rowsLayouts ? this._onLayoutRow.bind(this, key) : null}
          onActivate={this._onActivateRow.bind(this, key, index)}
          onPress={this._onPressRow.bind(this, key)}
          onRelease={this._onReleaseRow}
          onMove={this._onMoveRow}
          manuallyActivateRows={this.props.manuallyActivateRows}>
          {renderRow({
            key,
            data: data[key],
            disabled: !sortingEnabled,
            active,
            index,
          })}
        </Row>
      );
    });
  }

  _onUpdateLayouts() {
    Promise.all([...Object.values(this._rowsLayouts)])
      .then(([...rowsLayouts]) => {
        // Can get correct container’s layout only after rows’s layouts.
        this._container.measure((x, y, width, height, pageX, pageY) => {
          const rowsLayoutsByKey = {};
          let contentHeight = 0;
          let contentWidth = 0;

          rowsLayouts.forEach(({rowKey, layout}) => {
            rowsLayoutsByKey[rowKey] = layout;
            contentHeight += layout.height;
            contentWidth += layout.width;
          });

          this.setState({
            containerLayout: {x, y, width, height, pageX, pageY},
            rowsLayouts: rowsLayoutsByKey,
            contentHeight,
            contentWidth,
          }, () => {
            this.setState({animated: true});
          });
        });
      });
  }

  _scroll(animated) {
    this._scrollView.scrollTo({...this._contentOffset, animated});
  }

  _setOrderOnMove() {
    const {activeRowKey, order} = this.state;

    if (activeRowKey === null || this._autoScrollInterval) {
      return;
    }

    if (this._hoverIndex > this._initialRowIndex) {
      // Moving Down
      for (let i = 0; i < order.length; i++) {
        const shiftRowKey = order[i]
        const shiftRowLocation = this._rows[shiftRowKey].props.location;
        const key = order[i];
        if (i > this._initialRowIndex && i <= this._hoverIndex) {
          this._rows[key]._relocate({ x: shiftRowLocation.x, y: shiftRowLocation.y - 60 }, true);
        } else if (i !== this._initialRowIndex) {
          this._rows[key]._relocate({ x: shiftRowLocation.x, y: shiftRowLocation.y }, true);
        }
      }
    } else {
      // Moving Up
      for (let i = 0; i < order.length; i++) {
        const shiftRowKey = order[i]
        const shiftRowLocation = this._rows[shiftRowKey].props.location;
        const key = order[i];
        if (i < this._initialRowIndex && i >= this._hoverIndex) {
          this._rows[key]._relocate({ x: shiftRowLocation.x, y: shiftRowLocation.y + 60}, true);
        } else if (i !== this._initialRowIndex) {
          this._rows[key]._relocate({ x: shiftRowLocation.x, y: shiftRowLocation.y }, true);
        }
      }
    }
  }

  _scrollOnMove(e) {
    const {pageX, pageY} = e.nativeEvent;
    const {containerLayout} = this.state;
    let inAutoScrollBeginArea = false;
    let inAutoScrollEndArea = false;

    inAutoScrollBeginArea = pageY < containerLayout.pageY + this.props.autoscrollAreaSize;
    inAutoScrollEndArea = pageY > containerLayout.pageY + containerLayout.height - this.props.autoscrollAreaSize;

    if (!inAutoScrollBeginArea &&
      !inAutoScrollEndArea &&
      this._autoScrollInterval !== null
    ) {
      this._stopAutoScroll();
    }

    // It should scroll and scrolling is processing.
    if (this._autoScrollInterval !== null) {
      return;
    }

    if (inAutoScrollBeginArea) {
      this._startAutoScroll({
        direction: -1,
        shouldScroll: () => this._contentOffset['y'] > 0,
        getScrollStep: (stepIndex) => {
          const nextStep = this._getScrollStep(stepIndex);
          const contentOffset = this._contentOffset['y'];

          return contentOffset - nextStep < 0 ? contentOffset : nextStep;
        },
      });
    } else if (inAutoScrollEndArea) {
      this._startAutoScroll({
        direction: 1,
        shouldScroll: () => {
          const {
            contentHeight,
            contentWidth,
            containerLayout,
          } = this.state;

          return this._contentOffset.y < contentHeight - containerLayout.height;
        },
        getScrollStep: (stepIndex) => {
          const nextStep = this._getScrollStep(stepIndex);
          const {
            contentHeight,
            contentWidth,
            containerLayout,
          } = this.state;

          const scrollHeight = contentHeight - containerLayout.height;

          return this._contentOffset.y + nextStep > scrollHeight
            ? scrollHeight - this._contentOffset.y
            : nextStep;
        },
      });
    }
  }

  _getScrollStep(stepIndex) {
    return stepIndex > 3 ? 60 : 30;
  }

  _startAutoScroll({direction, shouldScroll, getScrollStep}) {
    if (!shouldScroll()) {
      return;
    }

    const {activeRowKey} = this.state;
    let counter = 0;

    this._autoScrollInterval = setInterval(() => {
      if (shouldScroll()) {
        const movement = {
          ['dy']: direction * getScrollStep(counter++),
        };

        this.scrollBy(movement);
        this._rows[activeRowKey].moveBy(movement);
      } else {
        this._stopAutoScroll();
      }
    }, AUTOSCROLL_INTERVAL);
  }

  _stopAutoScroll() {
    clearInterval(this._autoScrollInterval);
    this._autoScrollInterval = null;
    this._setOrderOnMove();
  }

  _onLayoutRow(rowKey, {nativeEvent: {layout}}) {
    this._resolveRowLayout[rowKey]({rowKey, layout});
  }

  _onActivateRow = (rowKey, index, e, gestureState, location) => {
    this._activeRowLocation = location;
    this._initialRowIndex = parseInt(index);
    this._hoverIndex = parseInt(index);
    this.setState({
      activeRowKey: rowKey,
      releasedRowKey: null,
      scrollEnabled: false,
    });

    if (this.props.onActivateRow) {
      this.props.onActivateRow(rowKey);
    }
  };

  _onPressRow = (rowKey) => {
    if (this.props.onPressRow) {
      this.props.onPressRow(rowKey);
    }
  };

  _onReleaseRow = () => {
    nextOrder = this.state.order.slice();
    nextOrder.splice(this._initialRowIndex, 1);
    nextOrder.splice(this._hoverIndex, 0, this.state.order[this._initialRowIndex]);

    this._stopAutoScroll();
    this.setState(({activeRowKey}) => ({
      order: nextOrder,
      activeRowKey: null,
      releasedRowKey: activeRowKey,
      scrollEnabled: this.props.scrollEnabled,
    }));
    
    if (this.props.onReleaseRow) {
      this.props.onReleaseRow(this._initialRowIndex, this._hoverIndex);
    }
    this._hoverIndex = undefined;
  };

  _onMoveRow = (e, gestureState, location, layout) => {
    if (gestureState.vy > 0.4 || gestureState.vy < -0.4) {
      return;
    }
    let hoverIndex;

    for (let i = 0; i < this.state.order.length; i++) {
      const row = this._rows[this.state.order[i]];
      const rowTop = row.props.location.y;
      const activeRowTop = location.y;
      const activeRowHeight = layout.height;
      const lowerSwapLimit = rowTop;
      const upperSwapLimit = lowerSwapLimit + layout.height;

      const inside = activeRowTop > lowerSwapLimit && activeRowTop < upperSwapLimit;
      if (inside) {
        hoverIndex = i;
        i = this.state.order.length;
      }
    }
    
    if (hoverIndex === this._hoverIndex || typeof(hoverIndex) === 'undefined' ) {
      this._hoverIndex = hoverIndex;
      return;
    }

    this._hoverIndex = hoverIndex;

    this._setOrderOnMove()

    if (this.props.scrollEnabled) {
      this._scrollOnMove(e);
    }
  };

  _onScroll = ({nativeEvent: {contentOffset}}) => {
      this._contentOffset = contentOffset;
  };

  _onRefContainer = (component) => {
    this._container = component;
  };

  _onRefScrollView = (component) => {
    this._scrollView = component;
  };

  _onRefRow = (rowKey, component) => {
    this._rows[rowKey] = component;
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  rowsContainer: {
    flex: 1,
    zIndex: 1,
  },
});
